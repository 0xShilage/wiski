import 'server-only';
import { isEpisodic } from '@/lib/catalog/kinds';
import { franchiseGoalCents, movieListPriceCents, seriesGoalCents } from '@/lib/catalog/pricing';
import { BOARD_STATUSES } from '@/lib/catalog/kinds';
import { db } from '../db';

/**
 * "Meta total" (2026-11-01): every current goal on the site added together — each movie on the
 * Filmes board (its price; met once it is sponsored) and each series and franchise (its campaign
 * goal and what it raised, capped at the goal). Watched titles have left the boards and no
 * longer count. Like every revenue goal on stream (Q19), only percentages and title counts leave
 * this module: never an amount.
 */
export type Kind = 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME';
export type KindTotal = { kind: Kind; titles: number; funded: number; percent: number };
export type TotalGoal = { titles: number; funded: number; percent: number; kinds: KindTotal[] };

const KINDS: Kind[] = ['MOVIE', 'SERIES', 'FRANCHISE', 'ANIME'];

/** floor, capped 0–100; an empty board counts as 0 %. */
export const pct = (current: number, target: number) =>
  target > 0 ? Math.max(0, Math.min(100, Math.floor((current * 100) / target))) : 0;

type Row = {
  kind: Kind;
  status: string;
  runtimeMinutes: number;
  manualPriceCents: number | null;
  seasonCount: number | null;
  campaign: { goalCents: number; raisedCents: number } | null;
  franchiseEntries: { runtimeMinutes: number }[];
};

/** One title's goal and progress in cents; null when it has no goal yet (nothing to count). */
export function titleGoal(r: Row): { target: number; current: number; funded: boolean } | null {
  try {
    if (r.kind === 'MOVIE') {
      const target = movieListPriceCents(r.runtimeMinutes, r.manualPriceCents);
      const funded = r.status === 'SPONSORED';
      return { target, current: funded ? target : 0, funded };
    }
    if (r.campaign) {
      const target = r.campaign.goalCents;
      const current = Math.min(r.campaign.raisedCents, target);
      return { target, current, funded: r.status === 'FUNDED' || current >= target };
    }
    // no campaign opened yet: the formula goal, nothing raised
    const target = isEpisodic(r.kind)
      ? r.seasonCount
        ? seriesGoalCents(r.seasonCount)
        : null
      : r.franchiseEntries.length
        ? franchiseGoalCents(r.franchiseEntries)
        : null;
    return target ? { target, current: 0, funded: false } : null;
  } catch {
    return null; // out-of-range data never breaks the overlay
  }
}

export function sumTotals(rows: Row[]): TotalGoal {
  const acc = Object.fromEntries(
    KINDS.map((k) => [k, { titles: 0, funded: 0, target: 0, current: 0 }]),
  ) as Record<Kind, { titles: number; funded: number; target: number; current: number }>;
  for (const r of rows) {
    const g = titleGoal(r);
    if (!g) continue;
    const a = acc[r.kind];
    a.titles += 1;
    a.funded += g.funded ? 1 : 0;
    a.target += g.target;
    a.current += g.current;
  }
  const all = KINDS.reduce(
    (t, k) => ({
      titles: t.titles + acc[k].titles,
      funded: t.funded + acc[k].funded,
      target: t.target + acc[k].target,
      current: t.current + acc[k].current,
    }),
    { titles: 0, funded: 0, target: 0, current: 0 },
  );
  return {
    titles: all.titles,
    funded: all.funded,
    percent: pct(all.current, all.target),
    // animes (2026-11-09) get their bar once there is one on the boards
    kinds: KINDS.filter((k) => k !== 'ANIME' || acc[k].titles > 0).map((k) => ({
      kind: k,
      titles: acc[k].titles,
      funded: acc[k].funded,
      percent: pct(acc[k].current, acc[k].target),
    })),
  };
}

export async function totalGoal(): Promise<TotalGoal> {
  const rows = await db().catalogItem.findMany({
    where: { status: { in: [...BOARD_STATUSES] } },
    select: {
      kind: true,
      status: true,
      runtimeMinutes: true,
      manualPriceCents: true,
      seasonCount: true,
      campaign: { select: { goalCents: true, raisedCents: true } },
      franchiseEntries: { select: { runtimeMinutes: true } },
    },
  });
  return sumTotals(rows);
}
