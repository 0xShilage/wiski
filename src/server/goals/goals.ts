import 'server-only';
import type { Goal, GoalMetric, Role } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { db } from '../db';
import { Problems } from '../http/problem';
import { refreshOverlays } from '../overlay/state';
import { codePointLength, plainText } from '../text/sanitize';

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

// ── admin (streamer) ──

type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

export type GoalInput = {
  title: string;
  metric: GoalMetric;
  target: number;
  startsAt: Date;
  endsAt?: Date | null | undefined;
  active?: boolean | undefined;
  showOnOverlay?: boolean | undefined;
  showOnMediaKit?: boolean | undefined;
};

function cleanTitle(raw: string): string {
  const t = plainText(raw);
  if (!t || codePointLength(t) > 60) {
    throw Problems.validation([{ path: 'title', message: 'Dê um nome de até 60 caracteres.' }]);
  }
  return t;
}

export async function listGoals(): Promise<GoalProgress[]> {
  const goals = await db().goal.findMany({ orderBy: { startsAt: 'desc' }, take: 50 });
  return Promise.all(goals.map(progress));
}

export async function createGoal(ctx: Ctx, input: GoalInput) {
  const title = cleanTitle(input.title);
  if (input.endsAt && input.endsAt <= input.startsAt) {
    throw Problems.validation([{ path: 'endsAt', message: 'O fim precisa ser depois do início.' }]);
  }
  const g = await db().$transaction(async (t) => {
    const g = await t.goal.create({
      data: {
        title,
        metric: input.metric,
        target: input.target,
        startsAt: input.startsAt,
        endsAt: input.endsAt ?? null,
        active: input.active ?? true,
        showOnOverlay: input.showOnOverlay ?? true,
        showOnMediaKit: input.showOnMediaKit ?? false,
      },
    });
    await audit(
      {
        action: 'goal.create',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Goal',
        targetId: g.id,
        metadata: { metric: g.metric, target: g.target },
      },
      t,
    );
    return g;
  });
  await refreshOverlays(['meta']);
  return progress(g);
}

export async function updateGoal(
  ctx: Ctx,
  id: string,
  input: { [K in keyof Omit<GoalInput, 'metric'>]?: GoalInput[K] | undefined },
) {
  const fields = (
    ['title', 'target', 'startsAt', 'endsAt', 'active', 'showOnOverlay', 'showOnMediaKit'] as const
  ).filter((k) => input[k] !== undefined);
  const g = await db().$transaction(async (t) => {
    const cur = await t.goal.findUnique({ where: { id } });
    if (!cur) throw Problems.notFound();
    const startsAt = input.startsAt ?? cur.startsAt;
    const endsAt = input.endsAt === undefined ? cur.endsAt : input.endsAt;
    if (endsAt && endsAt <= startsAt) {
      throw Problems.validation([
        { path: 'endsAt', message: 'O fim precisa ser depois do início.' },
      ]);
    }
    const g = await t.goal.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: cleanTitle(input.title) } : {}),
        ...(input.target !== undefined ? { target: input.target } : {}),
        ...(input.startsAt !== undefined ? { startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.showOnOverlay !== undefined ? { showOnOverlay: input.showOnOverlay } : {}),
        ...(input.showOnMediaKit !== undefined ? { showOnMediaKit: input.showOnMediaKit } : {}),
      },
    });
    await audit(
      {
        action: 'goal.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Goal',
        targetId: id,
        metadata: { fields: [...fields] },
      },
      t,
    );
    return g;
  });
  await refreshOverlays(['meta']);
  return progress(g);
}

export async function deleteGoal(ctx: Ctx, id: string) {
  await db().$transaction(async (t) => {
    const res = await t.goal.deleteMany({ where: { id } });
    if (res.count !== 1) throw Problems.notFound();
    await audit(
      {
        action: 'goal.delete',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Goal',
        targetId: id,
        metadata: {},
      },
      t,
    );
  });
  await refreshOverlays(['meta']);
}
