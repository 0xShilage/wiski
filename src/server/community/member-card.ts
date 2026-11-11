import 'server-only';
import type { MemberStats } from '@/lib/member-card';
import { db } from '../db';
import { COUNTED_ORDER_STATUSES } from './achievements';

/**
 * The numbers on the viewer's own membership card (/perfil, 2026-11-11). Private page, so every
 * paid order counts, anonymous ones too; refunded or unpaid ones don't. "Minutos de live" = the
 * running time of the films they sponsored that were already watched on stream (off-stream logs
 * excluded). Amounts are never read.
 */
export async function memberStats(userId: string): Promise<MemberStats> {
  const statuses = [...COUNTED_ORDER_STATUSES];
  const [sponsorships, contributions, watched, reviews] = await Promise.all([
    db().order.count({ where: { userId, kind: 'MOVIE', status: { in: statuses } } }),
    db().order.count({ where: { userId, kind: 'CONTRIBUTION', status: { in: statuses } } }),
    db().order.findMany({
      where: {
        userId,
        kind: 'MOVIE',
        status: { in: statuses },
        item: { watchedAt: { not: null }, offStream: false },
      },
      select: { item: { select: { runtimeMinutes: true } } },
    }),
    db().review.count({ where: { userId, status: 'VISIBLE' } }),
  ]);
  return {
    sponsorships,
    contributions,
    minutes: watched.reduce((sum, o) => sum + (o.item?.runtimeMinutes ?? 0), 0),
    reviews,
  };
}
