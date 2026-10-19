import 'server-only';
import type { User } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import { type AvatarKey } from '@/lib/avatars';
import { usernameRuleViolation } from '@/lib/username';
import { db } from '../db';
import { HttpError } from '../http/problem';
import { audit } from '../audit/audit';
import type { GoogleIdentity } from './oidc';

export const USERNAME_HOLD_MS = 30 * 24 * 3_600_000;
export const USERNAME_CHANGE_COOLDOWN_MS = 30 * 24 * 3_600_000;

/** Identity = Google `sub` (never the e-mail, which can change or be recycled). */
export async function upsertGoogleUser(identity: GoogleIdentity): Promise<User> {
  return db().user.upsert({
    where: { googleSub: identity.sub },
    create: { googleSub: identity.sub, email: identity.email, emailVerified: true },
    update: { email: identity.email, emailVerified: true },
  });
}

/** Is `name` free for `userId`? (format, reserved list, taken, or held for someone else). */
export async function isUsernameAvailable(
  name: string,
  userId: string | null,
  now = new Date(),
): Promise<boolean> {
  if (usernameRuleViolation(name) !== null) return false;
  const [owner, hold] = await Promise.all([
    db().user.findUnique({ where: { username: name }, select: { id: true } }),
    db().usernameHold.findUnique({ where: { username: name } }),
  ]);
  if (owner && owner.id !== userId) return false;
  if (hold && hold.holdUntil > now && hold.userId !== userId) return false;
  return true;
}

const taken = () =>
  new HttpError(409, 'USERNAME_TAKEN', 'Esse nome de usuário não está disponível.');

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** First-time onboarding: username + avatar, once. */
export async function completeOnboarding(
  user: Pick<User, 'id' | 'role' | 'username'>,
  input: { username: string; avatarKey: AvatarKey },
  requestId: string,
  now = new Date(),
): Promise<void> {
  if (user.username !== null)
    throw new HttpError(409, 'ALREADY_ONBOARDED', 'Seu perfil já foi criado.');
  if (!(await isUsernameAvailable(input.username, user.id, now))) throw taken();
  try {
    await db().$transaction(async (tx) => {
      const res = await tx.user.updateMany({
        where: { id: user.id, username: null },
        data: { username: input.username, avatarKey: input.avatarKey, usernameChangedAt: now },
      });
      if (res.count !== 1)
        throw new HttpError(409, 'ALREADY_ONBOARDED', 'Seu perfil já foi criado.');
      await tx.usernameHold.deleteMany({ where: { username: input.username, userId: user.id } });
      await audit(
        {
          action: 'user.onboarding',
          actor: { id: user.id, role: user.role },
          targetType: 'User',
          targetId: user.id,
          metadata: { username: input.username, avatarKey: input.avatarKey },
          requestId,
        },
        tx,
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw taken();
    throw err;
  }
}

/** Username change: at most once per 30 days; the old name is held 30 days for its owner. */
export async function changeUsername(
  user: Pick<User, 'id' | 'role' | 'username' | 'usernameChangedAt'>,
  next: string,
  requestId: string,
  now = new Date(),
): Promise<void> {
  if (user.username === null)
    throw new HttpError(409, 'NOT_ONBOARDED', 'Crie seu perfil primeiro.');
  if (next === user.username) return;
  if (
    user.usernameChangedAt &&
    now.getTime() - user.usernameChangedAt.getTime() < USERNAME_CHANGE_COOLDOWN_MS
  ) {
    throw new HttpError(
      409,
      'USERNAME_COOLDOWN',
      'Você só pode trocar o nome de usuário uma vez a cada 30 dias.',
    );
  }
  if (!(await isUsernameAvailable(next, user.id, now))) throw taken();
  const previous = user.username;
  try {
    await db().$transaction(async (tx) => {
      const res = await tx.user.updateMany({
        where: { id: user.id, username: previous },
        data: { username: next, usernameChangedAt: now },
      });
      if (res.count !== 1) throw taken();
      await tx.usernameHold.deleteMany({ where: { username: next, userId: user.id } });
      await tx.usernameHold.upsert({
        where: { username: previous },
        create: {
          username: previous,
          userId: user.id,
          releasedAt: now,
          holdUntil: new Date(now.getTime() + USERNAME_HOLD_MS),
        },
        update: {
          userId: user.id,
          releasedAt: now,
          holdUntil: new Date(now.getTime() + USERNAME_HOLD_MS),
        },
      });
      await audit(
        {
          action: 'user.username.change',
          actor: { id: user.id, role: user.role },
          targetType: 'User',
          targetId: user.id,
          metadata: { from: previous, to: next },
          requestId,
        },
        tx,
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw taken();
    throw err;
  }
}

export async function changeAvatar(
  user: Pick<User, 'id' | 'role'>,
  avatarKey: AvatarKey,
  requestId: string,
): Promise<void> {
  await db().$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { avatarKey } });
    await audit(
      {
        action: 'user.avatar.change',
        actor: { id: user.id, role: user.role },
        targetType: 'User',
        targetId: user.id,
        metadata: { avatarKey },
        requestId,
      },
      tx,
    );
  });
}

/** When may this user change their username again? (`null` = now) */
export function nextUsernameChange(
  user: Pick<User, 'usernameChangedAt'>,
  now = new Date(),
): Date | null {
  if (!user.usernameChangedAt) return null;
  const next = new Date(user.usernameChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS);
  return next > now ? next : null;
}
