import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { ModerationStatus, ReportStatus, Role } from '@/generated/prisma/enums';
import type {
  Anomaly,
  ModerationAction,
  ModerationQueue,
  QueueEntry,
  ReviewStatus,
} from '@/lib/reviews/types';
import { db } from '../db';
import { HttpError, Problems } from '../http/problem';
import type { RouteContext } from '../http/route';
import { reviewSelect, toOwnReview } from './read';

/**
 * Moderation of reviews (03 §5.6, 05 §5, Q15): MODERATOR+ with a fresh passkey hides, restores
 * and dismisses; only the STREAMER removes permanently. Every action is a compare-and-set on the
 * status the moderator saw (two moderators can't both act on a stale view), resolves the open
 * reports in the same transaction, and is audited.
 */
const DAY = 86_400_000;
const QUEUE_LIMIT = 50;
const HIDDEN_LIMIT = 20;

const TRANSITIONS: Record<
  ModerationAction,
  { from: readonly ModerationStatus[]; to: ModerationStatus; reports: ReportStatus }
> = {
  HIDE: { from: ['VISIBLE', 'AUTO_HIDDEN'], to: 'HIDDEN', reports: 'ACTIONED' },
  RESTORE: { from: ['AUTO_HIDDEN', 'HIDDEN'], to: 'VISIBLE', reports: 'DISMISSED' },
  DISMISS: { from: ['VISIBLE'], to: 'VISIBLE', reports: 'DISMISSED' },
  REMOVE: { from: ['VISIBLE', 'AUTO_HIDDEN', 'HIDDEN'], to: 'REMOVED', reports: 'ACTIONED' },
};

export const ModerationProblems = {
  invalid: () =>
    new HttpError(
      409,
      'INVALID_TRANSITION',
      'Esta ação não vale para o estado atual da avaliação.',
    ),
  changed: () =>
    new HttpError(
      409,
      'REVIEW_CHANGED',
      'Outra pessoa da moderação já mexeu nesta avaliação. Atualize a fila.',
    ),
};

type Audit = RouteContext<'moderator', undefined, undefined, unknown>['audit'];

export async function moderate(
  actor: { id: string; role: Role },
  reviewId: string,
  action: ModerationAction,
  expectedStatus: Exclude<ReviewStatus, 'REMOVED'>,
  audit: Audit,
  now = new Date(),
): Promise<{ status: ReviewStatus; resolvedReports: number }> {
  const t = TRANSITIONS[action];
  if (!t.from.includes(expectedStatus)) throw ModerationProblems.invalid();

  return db().$transaction(async (tx) => {
    const moved = await tx.review.updateMany({
      where: { id: reviewId, status: expectedStatus },
      data: {
        status: t.to,
        heldReason: null, // no action lands on AUTO_HIDDEN
        moderatedAt: now,
      },
    });
    if (moved.count === 0) {
      const exists = await tx.review.count({ where: { id: reviewId } });
      throw exists ? ModerationProblems.changed() : Problems.notFound();
    }
    const resolved = await tx.reviewReport.updateMany({
      where: { reviewId, status: 'OPEN' },
      data: { status: t.reports, resolvedById: actor.id, resolvedAt: now },
    });
    if (action === 'DISMISS' && resolved.count === 0) throw ModerationProblems.invalid();
    await audit(
      {
        action: 'moderation.review',
        targetType: 'review',
        targetId: reviewId,
        metadata: { action, from: expectedStatus, to: t.to, reports: resolved.count },
      },
      tx,
    );
    return { status: t.to, resolvedReports: resolved.count };
  });
}

const accountDays = (createdAt: Date, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / DAY));

async function entries(
  where: Prisma.ReviewWhereInput,
  take: number,
  orderBy: 'queue' | 'moderated',
  now: Date,
): Promise<QueueEntry[]> {
  const rows = await db().review.findMany({
    where,
    take,
    orderBy:
      orderBy === 'queue'
        ? [{ openReportCount: 'desc' }, { createdAt: 'asc' }]
        : [{ moderatedAt: 'desc' }],
    select: {
      ...reviewSelect,
      user: { select: { username: true, avatarKey: true, createdAt: true } },
      reports: {
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: {
          id: true,
          reason: true,
          note: true,
          createdAt: true,
          reporter: { select: { username: true, createdAt: true } },
        },
      },
    },
  });
  const counts = rows.length
    ? await db().review.groupBy({
        by: ['userId'],
        where: { userId: { in: [...new Set(rows.map((r) => r.userId))] } },
        _count: { _all: true },
      })
    : [];
  const reviewCount = new Map(counts.map((c) => [c.userId, c._count._all]));
  return rows.map((r) => ({
    review: {
      ...toOwnReview(r, ''),
      mine: false,
      authorAccountDays: accountDays(r.user.createdAt, now),
      authorReviewCount: reviewCount.get(r.userId) ?? 1,
    },
    openReports: r.reports.map((p) => ({
      id: p.id,
      reason: p.reason,
      note: p.note,
      createdAt: p.createdAt.toISOString(),
      reporter: {
        username: p.reporter.username,
        accountDays: accountDays(p.reporter.createdAt, now),
      },
    })),
  }));
}

/** Brigading signals (05 §5 A8): like bursts on one review, report bursts by one account. */
export async function anomalies(now = new Date()): Promise<Anomaly[]> {
  const since = new Date(now.getTime() - DAY);
  const young = new Date(now.getTime() - 7 * DAY);
  const [likeBursts, reportBursts] = await Promise.all([
    db().reviewLike.groupBy({
      by: ['reviewId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      having: { reviewId: { _count: { gte: 10 } } },
      orderBy: { _count: { reviewId: 'desc' } },
      take: 10,
    }),
    db().reviewReport.groupBy({
      by: ['reporterId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      having: { reporterId: { _count: { gte: 5 } } },
      orderBy: { _count: { reporterId: 'desc' } },
      take: 10,
    }),
  ]);
  const out: Anomaly[] = [];
  for (const b of likeBursts) {
    const [fromNew, review] = await Promise.all([
      db().reviewLike.count({
        where: {
          reviewId: b.reviewId,
          createdAt: { gte: since },
          user: { createdAt: { gt: young } },
        },
      }),
      db().review.findUnique({
        where: { id: b.reviewId },
        select: { item: { select: { title: true } } },
      }),
    ]);
    if (review && fromNew * 2 >= b._count._all) {
      out.push({
        kind: 'LIKE_BURST',
        reviewId: b.reviewId,
        title: review.item.title,
        likes24h: b._count._all,
        fromNewAccounts: fromNew,
      });
    }
  }
  if (reportBursts.length) {
    const users = await db().user.findMany({
      where: { id: { in: reportBursts.map((r) => r.reporterId) } },
      select: { id: true, username: true },
    });
    const name = new Map(users.map((u) => [u.id, u.username]));
    for (const r of reportBursts) {
      out.push({
        kind: 'REPORT_BURST',
        username: name.get(r.reporterId) ?? null,
        reports24h: r._count._all,
      });
    }
  }
  return out;
}

export async function moderationQueue(now = new Date()): Promise<ModerationQueue> {
  const [held, reported, hidden, total, signals] = await Promise.all([
    entries({ status: 'AUTO_HIDDEN' }, QUEUE_LIMIT, 'queue', now),
    entries({ status: 'VISIBLE', openReportCount: { gt: 0 } }, QUEUE_LIMIT, 'queue', now),
    entries({ status: 'HIDDEN' }, HIDDEN_LIMIT, 'moderated', now),
    waitingCount(),
    anomalies(now),
  ]);
  return {
    entries: [...held, ...reported].slice(0, QUEUE_LIMIT),
    hidden,
    anomalies: signals,
    total,
  };
}

/** Badge count for the dashboard sidebar. */
export function waitingCount(): Promise<number> {
  return db().review.count({
    where: { OR: [{ status: 'AUTO_HIDDEN' }, { status: 'VISIBLE', openReportCount: { gt: 0 } }] },
  });
}
