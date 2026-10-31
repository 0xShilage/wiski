import 'server-only';
import type { Goal, GoalMetric } from '@/generated/prisma/client';
import { db } from '../db';

/**
 * Goals (Q19): number of paid orders, revenue, or minutes watched on stream, counted inside the
 * goal's window. Revenue is shown publicly as a percentage only — never the amount.
 */
const PAID = ['PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED'] as const;

export type GoalProgress = {
  id: string;
  title: string;
  metric: GoalMetric;
  target: number;
  current: number;
  /** 0–100 (capped) */
  percent: number;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  showOnOverlay: boolean;
  showOnMediaKit: boolean;
};

export async function measure(g: Pick<Goal, 'metric' | 'startsAt' | 'endsAt'>): Promise<number> {
  const window = { gte: g.startsAt, ...(g.endsAt ? { lt: g.endsAt } : {}) };
  if (g.metric === 'WATCHED_MINUTES') {
    const events = await db().watchEvent.findMany({
      where: { watchedAt: window },
      select: { item: { select: { runtimeMinutes: true } } },
    });
    return events.reduce((n, e) => n + e.item.runtimeMinutes, 0);
  }
  const where = { status: { in: [...PAID] }, paidAt: window };
  if (g.metric === 'SPONSORSHIP_COUNT') return db().order.count({ where });
  const sum = await db().order.aggregate({ where, _sum: { totalCents: true } });
  return sum._sum.totalCents ?? 0;
}

export async function progress(g: Goal): Promise<GoalProgress> {
  const current = await measure(g);
  return {
    id: g.id,
    title: g.title,
    metric: g.metric,
    target: g.target,
    current,
    percent: Math.min(100, Math.floor((current * 100) / g.target)),
    startsAt: g.startsAt.toISOString(),
    endsAt: g.endsAt?.toISOString() ?? null,
    active: g.active,
    showOnOverlay: g.showOnOverlay,
    showOnMediaKit: g.showOnMediaKit,
  };
}

/** The goal on the stream overlay: the newest active one marked for it, still running. */
export async function overlayGoal(now = new Date()): Promise<GoalProgress | null> {
  const g = await db().goal.findFirst({
    where: {
      active: true,
      showOnOverlay: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    orderBy: { startsAt: 'desc' },
  });
  return g ? progress(g) : null;
}

export async function mediaKitGoals(now = new Date()): Promise<GoalProgress[]> {
  const goals = await db().goal.findMany({
    where: { active: true, showOnMediaKit: true, startsAt: { lte: now } },
    orderBy: { startsAt: 'desc' },
    take: 6,
  });
  return Promise.all(goals.map(progress));
}
