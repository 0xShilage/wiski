import 'server-only';
import type { Prisma, Role } from '@/generated/prisma/client';
import { canActOn } from '@/lib/roles';
import { normalizeUsername } from '@/lib/username';
import { audit } from '../audit/audit';
import { revokeAllSessions } from '../auth/session';
import { db } from '../db';
import { HttpError, Problems } from '../http/problem';

/**
 * People in the dashboard (03 §3 matrix, 05 §5): moderators suspend for up to 7 days; the
 * streamer (passkey + Google step-up, enforced by the routes) suspends for longer or indefinitely,
 * changes roles (USER ↔ MODERATOR) and grants VIP. Nobody acts on the streamer or on themselves;
 * a moderator must be demoted before a suspension (so a suspended account never moderates).
 * Super Moderador (2026-11-13): the streamer's powers here too, except that only the streamer
 * names or removes a Super Moderador, and only the streamer acts on one's account.
 * E-mails are shown to staff (moderators and the streamer, 2026-11-08).
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };
const DAY = 86_400_000;
/** Longer suspensions (or until lifted) ask for a fresh Google confirmation first. */
export const STEP_UP_SUSPENSION_DAYS = 7;
const PAGE = 30;

export const UserProblems = {
  self: () =>
    new HttpError(409, 'NOT_ON_YOURSELF', 'Você não pode fazer isto com a sua própria conta.'),
  protected: () =>
    new HttpError(409, 'PROTECTED_ACCOUNT', 'A conta do streamer não pode ser alterada aqui.'),
  superProtected: () =>
    new HttpError(409, 'PROTECTED_ACCOUNT', 'Só o streamer altera a conta de um Super Moderador.'),
  streamerOnly: () =>
    new HttpError(403, 'STREAMER_ONLY', 'Só o streamer nomeia ou tira um Super Moderador.'),
  privileged: () =>
    new HttpError(
      409,
      'DEMOTE_FIRST',
      'Tire o papel de moderação desta conta antes de suspendê-la.',
    ),
  changed: () =>
    new HttpError(409, 'USER_CHANGED', 'Esta conta mudou enquanto você olhava. Atualize.'),
  deleted: () => new HttpError(409, 'ACCOUNT_DELETED', 'Esta conta foi apagada.'),
};

const listSelect = {
  id: true,
  username: true,
  avatarKey: true,
  role: true,
  status: true,
  suspendedUntil: true,
  isVip: true,
  vipSince: true,
  createdAt: true,
  email: true,
  _count: { select: { reviews: true, orders: true } },
} satisfies Prisma.UserSelect;

type Row = Prisma.UserGetPayload<{ select: typeof listSelect }>;

function view(u: Row) {
  return {
    id: u.id,
    username: u.username,
    avatarKey: u.avatarKey,
    role: u.role,
    status: u.status,
    suspendedUntil: u.suspendedUntil?.toISOString() ?? null,
    isVip: u.isVip,
    createdAt: u.createdAt.toISOString(),
    email: u.email,
    reviewCount: u._count.reviews,
    orderCount: u._count.orders,
  };
}
export type AdminUser = ReturnType<typeof view>;

export async function listUsers(
  viewer: Role,
  q: { q?: string; filter?: 'all' | 'staff' | 'vip' | 'suspended'; after?: string },
) {
  const name = q.q ? normalizeUsername(q.q).replace(/[^a-z0-9_]/g, '') : '';
  const where: Prisma.UserWhereInput = {
    status: q.filter === 'suspended' ? 'SUSPENDED' : { not: 'DELETED' },
    ...(name ? { username: { startsWith: name } } : {}),
    ...(q.filter === 'staff' ? { role: { not: 'USER' } } : {}),
    ...(q.filter === 'vip' ? { isVip: true } : {}),
    ...(q.after ? { createdAt: { lt: new Date(q.after) } } : {}),
  };
  const rows = await db().user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: PAGE + 1,
    select: listSelect,
  });
  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  return {
    users: shown.map((u) => view(u)),
    next: more ? shown.at(-1)!.createdAt.toISOString() : null,
  };
}

async function target(id: string, actor: Ctx['actor']) {
  const u = await db().user.findUnique({ where: { id }, select: listSelect });
  if (!u) throw Problems.notFound();
  if (u.id === actor.id) throw UserProblems.self();
  if (u.role === 'STREAMER') throw UserProblems.protected();
  if (!canActOn(actor.role, u.role)) throw UserProblems.superProtected();
  if (u.status === 'DELETED') throw UserProblems.deleted();
  return u;
}

/** `days` null = until lifted. */
export async function suspendUser(ctx: Ctx, id: string, days: number | null, now = new Date()) {
  const u = await target(id, ctx.actor);
  if (u.role !== 'USER') throw UserProblems.privileged();
  const until = days === null ? null : new Date(now.getTime() + days * DAY);
  await db().$transaction(async (t) => {
    const res = await t.user.updateMany({
      where: { id, role: 'USER', status: { in: ['ACTIVE', 'SUSPENDED'] } },
      data: { status: 'SUSPENDED', suspendedUntil: until },
    });
    if (res.count !== 1) throw UserProblems.changed();
    await audit(
      {
        action: 'user.suspend',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'User',
        targetId: id,
        metadata: { until: until?.toISOString() ?? null, days },
      },
      t,
    );
  });
  return userById(ctx.actor.role, id);
}

export async function unsuspendUser(ctx: Ctx, id: string) {
  const u = await target(id, ctx.actor);
  if (u.status !== 'SUSPENDED') throw UserProblems.changed();
  await db().$transaction(async (t) => {
    const res = await t.user.updateMany({
      where: { id, status: 'SUSPENDED' },
      data: { status: 'ACTIVE', suspendedUntil: null },
    });
    if (res.count !== 1) throw UserProblems.changed();
    await audit(
      {
        action: 'user.unsuspend',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'User',
        targetId: id,
        metadata: {},
      },
      t,
    );
  });
  return userById(ctx.actor.role, id);
}

/**
 * Streamer powers: USER ↔ MODERATOR; the streamer alone also gives or takes SUPER_MODERATOR. Every
 * session of the person ends (a new role starts clean).
 */
export async function setRole(
  ctx: Ctx,
  id: string,
  role: 'USER' | 'MODERATOR' | 'SUPER_MODERATOR',
) {
  if (role === 'SUPER_MODERATOR' && ctx.actor.role !== 'STREAMER')
    throw UserProblems.streamerOnly();
  const u = await target(id, ctx.actor);
  if (u.role === role) return userById(ctx.actor.role, id);
  if (u.status !== 'ACTIVE') {
    throw new HttpError(409, 'ACCOUNT_NOT_ACTIVE', 'Reative a conta antes de mudar o papel.');
  }
  await db().$transaction(async (t) => {
    // the epoch bump also forgets every browser that remembered this person's second factor
    const res = await t.user.updateMany({
      where: { id, role: u.role },
      data: { role, mfaEpoch: { increment: 1 } },
    });
    if (res.count !== 1) throw UserProblems.changed();
    await audit(
      {
        action: 'user.role',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'User',
        targetId: id,
        metadata: { from: u.role, to: role },
      },
      t,
    );
  });
  await revokeAllSessions(id);
  return userById(ctx.actor.role, id);
}

/** Streamer: the 10 % VIP perk (04 §4). */
export async function setVip(ctx: Ctx, id: string, vip: boolean, now = new Date()) {
  const u = await target(id, ctx.actor);
  if (u.isVip === vip) return userById(ctx.actor.role, id);
  await db().$transaction(async (t) => {
    const res = await t.user.updateMany({
      where: { id, isVip: !vip },
      data: { isVip: vip, vipSince: vip ? now : null },
    });
    if (res.count !== 1) throw UserProblems.changed();
    await audit(
      {
        action: 'user.vip',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'User',
        targetId: id,
        metadata: { vip },
      },
      t,
    );
  });
  return userById(ctx.actor.role, id);
}

export async function userById(viewer: Role, id: string) {
  const u = await db().user.findUnique({ where: { id }, select: listSelect });
  if (!u) throw Problems.notFound();
  return view(u);
}
