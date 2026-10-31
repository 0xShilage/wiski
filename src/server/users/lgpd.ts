import 'server-only';
import type { User } from '@/generated/prisma/client';
import { DEFAULT_AVATAR } from '@/lib/avatars';
import { audit } from '../audit/audit';
import { db } from '../db';
import { HttpError } from '../http/problem';
import { USERNAME_HOLD_MS } from '../auth/accounts';
import { randomToken } from '../security/crypto';

/**
 * LGPD self-service (05 §13, 02 §5, Q14): download everything we hold about you, or erase your
 * account. Erasure removes reviews, likes, reports, suggestions and passkeys, ends every session and
 * anonymises the account row (it stays only so paid orders — kept 5 years for tax/accounting —
 * still point somewhere). The username is held for 30 days so nobody can take it over at once.
 */
export const LgpdProblems = {
  streamer: () =>
    new HttpError(409, 'STREAMER_ACCOUNT', 'A conta do streamer não pode ser apagada por aqui.'),
  confirm: () =>
    new HttpError(
      422,
      'CONFIRMATION_MISMATCH',
      'Digite seu nome de usuário exatamente como aparece.',
    ),
  pending: () =>
    new HttpError(
      409,
      'PENDING_ORDER',
      'Você tem um pedido aguardando pagamento. Pague ou cancele antes de apagar a conta.',
    ),
};

export async function exportMyData(user: User, requestId: string | null) {
  const [sessions, orders, reviews, likes, reports, legal, passkeys, suggestions] =
    await Promise.all([
      db().session.findMany({
        where: { userId: user.id },
        select: { createdAt: true, lastSeenAt: true, uaFamily: true, revokedAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      db().order.findMany({
        where: { userId: user.id },
        select: {
          publicCode: true,
          kind: true,
          status: true,
          totalCents: true,
          createdAt: true,
          paidAt: true,
          contactEmail: true,
          sponsorMessage: true,
          showSponsorName: true,
          item: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      db().review.findMany({
        where: { userId: user.id },
        select: {
          rating: true,
          body: true,
          containsSpoilers: true,
          status: true,
          createdAt: true,
          editedAt: true,
          item: { select: { title: true } },
        },
      }),
      db().reviewLike.findMany({
        where: { userId: user.id },
        select: { createdAt: true, review: { select: { item: { select: { title: true } } } } },
      }),
      db().reviewReport.findMany({
        where: { reporterId: user.id },
        select: { reason: true, note: true, status: true, createdAt: true },
      }),
      db().legalAcceptance.findMany({
        where: { OR: [{ userId: user.id }, { order: { userId: user.id } }] },
        select: { acceptedAt: true, document: { select: { type: true, version: true } } },
      }),
      db().passkey.findMany({
        where: { userId: user.id },
        select: { label: true, createdAt: true, lastUsedAt: true },
      }),
      db().suggestion.findMany({
        where: { userId: user.id },
        select: { kind: true, title: true, year: true, note: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
  await audit({
    action: 'user.export',
    actor: { id: user.id, role: user.role },
    requestId,
    targetType: 'User',
    targetId: user.id,
    metadata: {},
  });
  return {
    exportedAt: new Date().toISOString(),
    account: {
      username: user.username,
      email: user.email,
      avatarKey: user.avatarKey,
      role: user.role,
      vip: user.isVip,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    },
    sessions,
    orders: orders.map(({ item, ...o }) => ({ ...o, title: item.title })),
    reviews: reviews.map(({ item, ...r }) => ({ ...r, title: item.title })),
    likes: likes.map((l) => ({ createdAt: l.createdAt, title: l.review.item.title })),
    reports,
    legalAcceptances: legal.map((l) => ({ ...l.document, acceptedAt: l.acceptedAt })),
    passkeys,
    suggestions,
    // never the secret or the codes — only whether it is on
    authenticatorApp: {
      enabledAt: user.totpEnabledAt?.toISOString() ?? null,
    },
  };
}

export async function eraseMyAccount(
  user: User,
  confirmUsername: string,
  requestId: string | null,
  now = new Date(),
) {
  if (user.role === 'STREAMER') throw LgpdProblems.streamer();
  if (!user.username || confirmUsername.trim().toLowerCase() !== user.username) {
    throw LgpdProblems.confirm();
  }
  const pending = await db().order.count({ where: { userId: user.id, status: 'PENDING_PAYMENT' } });
  if (pending) throw LgpdProblems.pending();
  const tag = randomToken(6)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '0')
    .slice(0, 8)
    .padEnd(8, '0');
  await db().$transaction(async (t) => {
    const reviews = await t.review.deleteMany({ where: { userId: user.id } }); // likes/reports on them cascade
    await t.reviewLike.deleteMany({ where: { userId: user.id } });
    await t.reviewReport.deleteMany({ where: { reporterId: user.id } });
    await t.passkey.deleteMany({ where: { userId: user.id } });
    await t.suggestion.deleteMany({ where: { userId: user.id } });
    await t.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await t.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });
    const orders = await t.order.count({ where: { userId: user.id } });
    if (user.username) {
      await t.usernameHold.upsert({
        where: { username: user.username },
        create: {
          username: user.username,
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
    }
    await t.user.update({
      where: { id: user.id },
      data: {
        status: 'DELETED',
        deletedAt: now,
        suspendedUntil: null,
        username: `removido_${tag}`,
        usernameChangedAt: null,
        email: `removido-${user.id}@invalid.wiski.fun`,
        emailVerified: false,
        googleSub: `deleted:${user.id}`,
        avatarKey: DEFAULT_AVATAR,
        role: 'USER',
        isVip: false,
        vipSince: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        totpLastStep: null,
        mfaEpoch: { increment: 1 },
      },
    });
    await audit(
      {
        action: 'user.erase',
        actor: { id: user.id, role: user.role },
        requestId,
        targetType: 'User',
        targetId: user.id,
        metadata: { reviews: reviews.count, orders },
      },
      t,
    );
  });
}
