import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { type AchievementStats, evaluateAchievements } from '@/lib/achievements';
import { audit } from '../audit/audit';
import { db } from '../db';

/**
 * Badges and the ranking (2026-11-04, docs/phase-6/README.md §12). Only facts already public under
 * the username count: sponsorships and contributions that show the sponsor's name (anonymous ones
 * never), visible reviews and their likes. Refunded or unpaid orders don't count. Amounts are
 * never read. A viewer who turns "showAchievements" off keeps their badges on /perfil only and
 * leaves the ranking.
 */
export const COUNTED_ORDER_STATUSES = ['PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED'] as const;
const DAY_MS = 86_400_000;

/** Orders that count for badges and the ranking (named, paid, not refunded). */
export function countedOrders(kind: 'MOVIE' | 'CONTRIBUTION'): Prisma.OrderWhereInput {
  return { kind, status: { in: [...COUNTED_ORDER_STATUSES] }, showSponsorName: true };
}

export async function achievementStats(
  user: { id: string; createdAt: Date; isVip: boolean },
  now = new Date(),
): Promise<AchievementStats> {
  const [sponsorships, contributions, reviews] = await Promise.all([
    db().order.count({ where: { ...countedOrders('MOVIE'), userId: user.id } }),
    db().order.count({ where: { ...countedOrders('CONTRIBUTION'), userId: user.id } }),
    db().review.aggregate({
      where: { userId: user.id, status: 'VISIBLE' },
      _count: { _all: true },
      _sum: { likeCount: true },
    }),
  ]);
  return {
    sponsorships,
    contributions,
    reviews: reviews._count._all,
    likes: reviews._sum.likeCount ?? 0,
    memberDays: Math.max(0, Math.floor((now.getTime() - user.createdAt.getTime()) / DAY_MS)),
    vip: user.isVip,
  };
}

export async function achievementsFor(
  user: { id: string; createdAt: Date; isVip: boolean },
  now = new Date(),
) {
  return evaluateAchievements(await achievementStats(user, now));
}

/** /perfil switch: badges on the public profile and a place in the ranking. */
export async function setShowAchievements(
  user: { id: string; role: 'USER' | 'MODERATOR' | 'STREAMER' },
  show: boolean,
  requestId: string | null,
): Promise<void> {
  await db().$transaction(async (t) => {
    await t.user.update({ where: { id: user.id }, data: { showAchievements: show } });
    await audit(
      {
        action: 'user.achievements.visibility',
        actor: { id: user.id, role: user.role },
        requestId,
        targetType: 'User',
        targetId: user.id,
        metadata: { show },
      },
      t,
    );
  });
}
