import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '../db';
import { countedOrders } from './achievements';

/**
 * /ranking (2026-11-04): who sponsored the most movies (with their name shown), who wrote the most
 * reviews, whose reviews got the most likes. Counts only — never amounts. Only active accounts with
 * a username that didn't turn the ranking off; the streamer isn't ranked. "Este mês" is the
 * calendar month in São Paulo.
 */
export type RankingBoard = 'patrocinadores' | 'criticos' | 'curtidas';
export type RankingPeriod = 'mes' | 'geral';
export type RankingRow = { position: number; username: string; avatarKey: string; value: number };

export const RANKING_SIZE = 10;
/** more than shown, so ties at the cut are decided by the same rule as the rest */
const CANDIDATES = 50;
const BRT_OFFSET_MS = 3 * 3_600_000; // America/Sao_Paulo: fixed −03:00 (no DST since 2019)

/** The first instant of the São Paulo calendar month of `now`. */
export function monthStart(now: Date): Date {
  const local = new Date(now.getTime() - BRT_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + BRT_OFFSET_MS);
}

const rankedUser: Prisma.UserWhereInput = {
  status: 'ACTIVE',
  username: { not: null },
  showAchievements: true,
  role: { not: 'STREAMER' },
};

async function rows(counts: { userId: string | null; value: number }[]): Promise<RankingRow[]> {
  const byId = new Map(
    counts.filter((c) => c.userId && c.value > 0).map((c) => [c.userId!, c.value]),
  );
  if (!byId.size) return [];
  const users = await db().user.findMany({
    where: { id: { in: [...byId.keys()] }, ...rankedUser },
    select: { id: true, username: true, avatarKey: true },
  });
  const sorted = users
    .map((u) => ({ username: u.username!, avatarKey: u.avatarKey, value: byId.get(u.id)! }))
    .sort((a, b) => b.value - a.value || a.username.localeCompare(b.username))
    .slice(0, RANKING_SIZE);
  return withPositions(sorted);
}

/** Equal values share a position: 1, 2, 2, 4 (standard competition ranking). */
export function withPositions<T extends { value: number }>(
  sorted: T[],
): (T & { position: number })[] {
  const out: (T & { position: number })[] = [];
  sorted.forEach((r, i) => {
    const prev = out[i - 1];
    out.push({ ...r, position: prev && prev.value === r.value ? prev.position : i + 1 });
  });
  return out;
}

export async function ranking(
  board: RankingBoard,
  period: RankingPeriod,
  now = new Date(),
): Promise<RankingRow[]> {
  const since = period === 'mes' ? monthStart(now) : null;
  if (board === 'patrocinadores') {
    const groups = await db().order.groupBy({
      by: ['userId'],
      where: {
        ...countedOrders('MOVIE'),
        userId: { not: null },
        user: rankedUser,
        ...(since ? { paidAt: { gte: since } } : {}),
      },
      _count: { _all: true },
      orderBy: { _count: { userId: 'desc' } },
      take: CANDIDATES,
    });
    return rows(groups.map((g) => ({ userId: g.userId, value: g._count._all })));
  }
  if (board === 'criticos') {
    const groups = await db().review.groupBy({
      by: ['userId'],
      where: {
        status: 'VISIBLE',
        user: rankedUser,
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _count: { _all: true },
      orderBy: { _count: { userId: 'desc' } },
      take: CANDIDATES,
    });
    return rows(groups.map((g) => ({ userId: g.userId, value: g._count._all })));
  }
  // likes received: all-time (the like counter lives on the review)
  const groups = await db().review.groupBy({
    by: ['userId'],
    where: { status: 'VISIBLE', likeCount: { gt: 0 }, user: rankedUser },
    _sum: { likeCount: true },
    orderBy: { _sum: { likeCount: 'desc' } },
    take: CANDIDATES,
  });
  return rows(groups.map((g) => ({ userId: g.userId, value: g._sum.likeCount ?? 0 })));
}

export async function rankings(now = new Date()) {
  const [sponsorsMonth, sponsorsAll, criticsMonth, criticsAll, likes] = await Promise.all([
    ranking('patrocinadores', 'mes', now),
    ranking('patrocinadores', 'geral', now),
    ranking('criticos', 'mes', now),
    ranking('criticos', 'geral', now),
    ranking('curtidas', 'geral', now),
  ]);
  return {
    patrocinadores: { mes: sponsorsMonth, geral: sponsorsAll },
    criticos: { mes: criticsMonth, geral: criticsAll },
    curtidas: { geral: likes },
  };
}
