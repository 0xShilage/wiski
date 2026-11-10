import 'server-only';
import {
  type AnalyticsDays,
  bucketSums,
  bucketsFor,
  changePercent,
  granularityOf,
  periodStart,
} from '@/lib/analytics';
import type { RoletaPrize } from '@/lib/roleta';
import { COUNTED_ORDER_STATUSES } from '../community/achievements';
import { db } from '../db';

/**
 * Admin › Análise (2026-11-04; moderators too since 2026-11-08): money and community numbers for a period, with the
 * same period before it for comparison. Read-only. Revenue = paid orders that weren't refunded
 * (a refunded order leaves the counted statuses), by the day they were paid, in São Paulo.
 */
const DAY_MS = 86_400_000;

export type AnalyticsView = {
  days: AnalyticsDays;
  granularity: 'day' | 'week' | 'month';
  from: string;
  revenue: {
    cents: number;
    previousCents: number;
    change: number | null;
    checkoutCents: number;
    manualCents: number;
    orders: number;
    previousOrders: number;
    averageCents: number;
    movies: number;
    contributions: number;
  };
  series: { label: string; cents: number; orders: number }[];
  conversion: { created: number; paid: number; percent: number | null };
  refunds: { count: number; cents: number };
  topTitles: {
    title: string;
    kind: 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME';
    cents: number;
    orders: number;
  }[];
  community: {
    newAccounts: number;
    previousNewAccounts: number;
    reviews: number;
    suggestions: number;
  };
  roleta: {
    spins: number;
    players: number;
    prizes: { prize: Exclude<RoletaPrize, 'NADA'>; count: number }[];
    couponsUsed: number;
  };
  subathons: {
    title: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    addedSeconds: number;
    entries: number;
  }[];
};

export async function analytics(days: AnalyticsDays, now = new Date()): Promise<AnalyticsView> {
  const from = periodStart(days, now);
  const prevFrom = new Date(from.getTime() - days * DAY_MS);
  const counted = { status: { in: [...COUNTED_ORDER_STATUSES] } };
  const inPeriod = { gte: from, lte: now };
  const inPrev = { gte: prevFrom, lt: from };

  const [
    paid,
    prev,
    created,
    createdPaid,
    refunds,
    newAccounts,
    prevAccounts,
    reviews,
    suggestions,
  ] = await Promise.all([
    db().order.findMany({
      where: { ...counted, paidAt: inPeriod },
      select: { paidAt: true, totalCents: true, source: true, kind: true, itemId: true },
    }),
    db().order.aggregate({
      where: { ...counted, paidAt: inPrev },
      _sum: { totalCents: true },
      _count: { _all: true },
    }),
    db().order.count({ where: { source: 'CHECKOUT', createdAt: inPeriod } }),
    db().order.count({ where: { source: 'CHECKOUT', createdAt: inPeriod, paidAt: { not: null } } }),
    db().refund.aggregate({
      where: { status: 'APPROVED', createdAt: inPeriod },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    db().user.count({ where: { createdAt: inPeriod } }),
    db().user.count({ where: { createdAt: inPrev } }),
    db().review.count({ where: { createdAt: inPeriod } }),
    db().suggestion.count({ where: { createdAt: inPeriod } }),
  ]);

  const cents = paid.reduce((s, o) => s + o.totalCents, 0);
  const buckets = bucketsFor(days, now);
  const sums = bucketSums(
    buckets,
    paid.map((o) => ({ at: o.paidAt!.getTime(), value: o.totalCents })),
  );
  const counts = bucketSums(
    buckets,
    paid.map((o) => ({ at: o.paidAt!.getTime(), value: 1 })),
  );

  const byItem = new Map<string, { cents: number; orders: number }>();
  for (const o of paid) {
    const cur = byItem.get(o.itemId) ?? { cents: 0, orders: 0 };
    byItem.set(o.itemId, { cents: cur.cents + o.totalCents, orders: cur.orders + 1 });
  }
  const topIds = [...byItem.entries()].sort((a, b) => b[1].cents - a[1].cents).slice(0, 8);
  const items = topIds.length
    ? await db().catalogItem.findMany({
        where: { id: { in: topIds.map(([id]) => id) } },
        select: { id: true, title: true, kind: true },
      })
    : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const [spins, players, prizeGroups, couponsUsed, subathons] = await Promise.all([
    db().roletaSpin.count({ where: { createdAt: inPeriod } }),
    db().roletaSpin.groupBy({ by: ['userId'], where: { createdAt: inPeriod } }),
    db().roletaSpin.groupBy({
      by: ['prize'],
      where: { createdAt: inPeriod, prize: { not: 'NADA' } },
      _count: { _all: true },
    }),
    db().roletaSpin.count({
      where: { createdAt: inPeriod, prize: 'CUPOM_30', voucher: { redemptionCount: { gt: 0 } } },
    }),
    db().subathon.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        title: true,
        status: true,
        startedAt: true,
        endedAt: true,
        addedSeconds: true,
        _count: { select: { entries: true } },
      },
    }),
  ]);

  const prevCents = prev._sum.totalCents ?? 0;
  return {
    days,
    granularity: granularityOf(days),
    from: from.toISOString(),
    revenue: {
      cents,
      previousCents: prevCents,
      change: changePercent(cents, prevCents),
      checkoutCents: paid
        .filter((o) => o.source === 'CHECKOUT')
        .reduce((s, o) => s + o.totalCents, 0),
      manualCents: paid
        .filter((o) => o.source !== 'CHECKOUT')
        .reduce((s, o) => s + o.totalCents, 0),
      orders: paid.length,
      previousOrders: prev._count._all,
      averageCents: paid.length ? Math.round(cents / paid.length) : 0,
      movies: paid.filter((o) => o.kind === 'MOVIE').length,
      contributions: paid.filter((o) => o.kind === 'CONTRIBUTION').length,
    },
    series: buckets.map((b, i) => ({ label: b.label, cents: sums[i]!, orders: counts[i]! })),
    conversion: {
      created,
      paid: createdPaid,
      percent: created ? Math.round((createdPaid / created) * 100) : null,
    },
    refunds: { count: refunds._count._all, cents: refunds._sum.amountCents ?? 0 },
    topTitles: topIds.flatMap(([id, v]) => {
      const it = itemById.get(id);
      return it ? [{ title: it.title, kind: it.kind, ...v }] : [];
    }),
    community: { newAccounts, previousNewAccounts: prevAccounts, reviews, suggestions },
    roleta: {
      spins,
      players: players.length,
      prizes: prizeGroups
        .map((g) => ({ prize: g.prize as Exclude<RoletaPrize, 'NADA'>, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
      couponsUsed,
    },
    subathons: subathons.map((s) => ({
      title: s.title,
      status: s.status,
      startedAt: s.startedAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
      addedSeconds: s.addedSeconds,
      entries: s._count.entries,
    })),
  };
}
