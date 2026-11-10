import 'server-only';
import type { ItemKind } from '@/generated/prisma/client';
import { db } from '../db';

/**
 * The home page's progress block (Phase 6): titles watched on stream, how long they run in total
 * (catalog runtimes, not measured stream time) and what is paid or funded but not watched yet.
 * Each number comes with a per-kind split.
 */
export type PerKind = Record<ItemKind, number>;
export type WatchProgress = {
  watched: { total: number; byKind: PerKind };
  minutes: { total: number; byKind: PerKind };
  queued: { total: number; byKind: PerKind };
};

const zero = (): PerKind => ({ MOVIE: 0, SERIES: 0, FRANCHISE: 0, ANIME: 0 });
const sum = (k: PerKind) => k.MOVIE + k.SERIES + k.FRANCHISE;

export async function watchProgress(): Promise<WatchProgress> {
  const [watchedRows, movieQueue, campaignQueue] = await Promise.all([
    // watchedAt survives archiving (a replaced slot still counts as watched)
    db().catalogItem.groupBy({
      by: ['kind'],
      where: { watchedAt: { not: null } },
      _count: { _all: true },
      _sum: { runtimeMinutes: true },
    }),
    // paid movies waiting for a live, with or without a date
    db().order.count({ where: { kind: 'MOVIE', status: { in: ['PAID', 'SCHEDULED'] } } }),
    // funded series and franchises waiting for a live, with or without a date
    db().campaign.findMany({
      where: { status: { in: ['FUNDED', 'SCHEDULED'] } },
      select: { item: { select: { kind: true } } },
    }),
  ]);
  const watched = zero();
  const minutes = zero();
  for (const r of watchedRows) {
    watched[r.kind] = r._count._all;
    minutes[r.kind] = r._sum.runtimeMinutes ?? 0;
  }
  const queued = zero();
  queued.MOVIE = movieQueue;
  for (const c of campaignQueue) queued[c.item.kind] += 1;
  return {
    watched: { total: sum(watched), byKind: watched },
    minutes: { total: sum(minutes), byKind: minutes },
    queued: { total: sum(queued), byKind: queued },
  };
}
