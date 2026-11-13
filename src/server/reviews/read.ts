import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import {
  REVIEW_PAGE_SIZE,
  type OwnReview,
  type PublicReview,
  type RatingSummary,
  type ReviewEligibility,
  type ReviewPage,
  type ReviewSort,
} from '@/lib/reviews/types';
import { normalizeUsername, USERNAME_PATTERN } from '@/lib/username';
import { db } from '../db';
import { decodeCursor, encodeCursor } from './cursor';

/**
 * Review read models (03 §5.4). Public lists show VISIBLE reviews of authors whose account still
 * exists; never an e-mail, Google id, role or moderation detail. The viewer's own review comes
 * separately (`ownReview`) so they can see a hidden one with its notice.
 */
export const reviewSelect = {
  id: true,
  rating: true,
  body: true,
  containsSpoilers: true,
  likeCount: true,
  status: true,
  heldReason: true,
  createdAt: true,
  editedAt: true,
  userId: true,
  user: { select: { username: true, avatarKey: true } },
  item: { select: { kind: true, slug: true, title: true } },
} satisfies Prisma.ReviewSelect;

type Row = Prisma.ReviewGetPayload<{ select: typeof reviewSelect }>;

/** Reviews anyone may see. */
export const PUBLIC_REVIEW: Prisma.ReviewWhereInput = {
  status: 'VISIBLE',
  user: { status: { not: 'DELETED' }, username: { not: null } },
};

export function toPublicReview(
  row: Row,
  viewerId?: string | null,
  liked?: Set<string>,
): PublicReview {
  return {
    id: row.id,
    rating: row.rating,
    body: row.body,
    containsSpoilers: row.containsSpoilers,
    likeCount: row.likeCount,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    author: { username: row.user.username ?? 'usuario', avatarKey: row.user.avatarKey },
    item: row.item,
    ...(viewerId ? { likedByMe: liked?.has(row.id) ?? false, mine: row.userId === viewerId } : {}),
  };
}

export function toOwnReview(row: Row, viewerId: string): OwnReview {
  return { ...toPublicReview(row, viewerId), status: row.status, heldReason: row.heldReason };
}

async function likedBy(viewerId: string | null | undefined, ids: string[]): Promise<Set<string>> {
  if (!viewerId || ids.length === 0) return new Set();
  const rows = await db().reviewLike.findMany({
    where: { userId: viewerId, reviewId: { in: ids } },
    select: { reviewId: true },
  });
  return new Set(rows.map((r) => r.reviewId));
}

function keyset(sort: ReviewSort, raw: string | undefined): Prisma.ReviewWhereInput | null {
  const k = decodeCursor(raw, sort === 'top');
  if (!k) return null;
  const sameTime = { createdAt: k.createdAt, id: { lt: k.id } };
  if (sort === 'recent') return { OR: [{ createdAt: { lt: k.createdAt } }, sameTime] };
  return {
    OR: [
      { likeCount: { lt: k.likeCount! } },
      { likeCount: k.likeCount!, createdAt: { lt: k.createdAt } },
      { likeCount: k.likeCount!, ...sameTime },
    ],
  };
}

async function page(
  where: Prisma.ReviewWhereInput,
  sort: ReviewSort,
  cursor: string | undefined,
  viewerId: string | null | undefined,
  size = REVIEW_PAGE_SIZE,
): Promise<ReviewPage> {
  const after = keyset(sort, cursor);
  const rows = await db().review.findMany({
    where: { AND: [PUBLIC_REVIEW, where, ...(after ? [after] : [])] },
    orderBy:
      sort === 'top'
        ? [{ likeCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],
    take: size + 1,
    select: reviewSelect,
  });
  const more = rows.length > size;
  const shown = rows.slice(0, size);
  const liked = await likedBy(
    viewerId,
    shown.map((r) => r.id),
  );
  const last = shown.at(-1);
  return {
    reviews: shown.map((r) => toPublicReview(r, viewerId, liked)),
    nextCursor:
      more && last
        ? encodeCursor({
            createdAt: last.createdAt,
            id: last.id,
            ...(sort === 'top' ? { likeCount: last.likeCount } : {}),
          })
        : null,
  };
}

/** Items whose reviews are public: watched on stream (WATCHED, or ARCHIVED after watching). */
export async function reviewableItem(itemId: string) {
  const item = await db().catalogItem.findFirst({
    where: { id: itemId, status: { in: ['WATCHED', 'ARCHIVED'] }, watchEvents: { some: {} } },
    select: { id: true, kind: true, slug: true, title: true },
  });
  return item;
}

export function itemReviews(
  itemId: string,
  sort: ReviewSort,
  cursor: string | undefined,
  viewerId?: string | null,
): Promise<ReviewPage> {
  return page({ itemId }, sort, cursor, viewerId);
}

export function latestReviews(
  cursor: string | undefined,
  viewerId?: string | null,
  size = REVIEW_PAGE_SIZE,
): Promise<ReviewPage> {
  return page({}, 'recent', cursor, viewerId, size);
}

export async function ratingSummary(itemId: string): Promise<RatingSummary> {
  const groups = await db().review.groupBy({
    by: ['rating'],
    where: { AND: [PUBLIC_REVIEW, { itemId }] },
    _count: { _all: true },
  });
  const distribution: RatingSummary['distribution'] = [0, 0, 0, 0, 0];
  let sum = 0;
  let count = 0;
  for (const g of groups) {
    distribution[g.rating - 1] = g._count._all;
    sum += g.rating * g._count._all;
    count += g._count._all;
  }
  return { count, average10: count ? Math.round((sum * 10) / count) : null, distribution };
}

/** { itemId → { count, average10 } } for the watched-titles grid on /avaliacoes. */
export async function ratingsFor(itemIds: string[]) {
  if (!itemIds.length) return new Map<string, { count: number; average10: number }>();
  const groups = await db().review.groupBy({
    by: ['itemId'],
    where: { AND: [PUBLIC_REVIEW, { itemId: { in: itemIds } }] },
    _count: { _all: true },
    _avg: { rating: true },
  });
  return new Map(
    groups.map((g) => [
      g.itemId,
      { count: g._count._all, average10: Math.round((g._avg.rating ?? 0) * 10) },
    ]),
  );
}

export async function ownReview(itemId: string, userId: string): Promise<OwnReview | null> {
  const row = await db().review.findUnique({
    where: { userId_itemId: { userId, itemId } },
    select: reviewSelect,
  });
  return row ? toOwnReview(row, userId) : null;
}

type Viewer = { id: string; status: string; username: string | null } | null;

export async function eligibility(
  itemId: string,
  viewer: Viewer,
  own?: OwnReview | null,
): Promise<ReviewEligibility> {
  if (!(await reviewableItem(itemId))) return 'NOT_WATCHED';
  if (!viewer) return 'SIGNED_OUT';
  if (!viewer.username) return 'ONBOARDING';
  if (viewer.status !== 'ACTIVE') return 'SUSPENDED';
  const mine = own === undefined ? await ownReview(itemId, viewer.id) : own;
  return mine ? 'ALREADY_REVIEWED' : 'OK';
}

// ── Public profiles (/u/[username]) ──

export async function findProfile(raw: string) {
  if (raw.length > 64) return null;
  const username = normalizeUsername(raw);
  if (!USERNAME_PATTERN.test(username)) return null;
  // Public fields only — never e-mail, Google id or role details.
  const user = await db().user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      avatarKey: true,
      createdAt: true,
      status: true,
      isVip: true,
      showAchievements: true,
    },
  });
  if (!user || user.status === 'DELETED' || !user.username) return null;
  const reviewCount = await db().review.count({
    where: { AND: [PUBLIC_REVIEW, { userId: user.id }] },
  });
  return {
    id: user.id,
    username: user.username,
    avatarKey: user.avatarKey,
    createdAt: user.createdAt,
    reviewCount,
    isVip: user.isVip,
    showAchievements: user.showAchievements,
  };
}

export function userReviews(
  userId: string,
  cursor: string | undefined,
  viewerId?: string | null,
): Promise<ReviewPage> {
  return page({ userId }, 'recent', cursor, viewerId);
}

/**
 * Críticas como recortes de jornal (2026-11-13): a title's most-liked public review (at least one
 * like, no spoilers), for the clipping above the list. Ties go to the oldest.
 */
export async function topReview(itemId: string): Promise<PublicReview | null> {
  const row = await db().review.findFirst({
    where: { itemId, ...PUBLIC_REVIEW, containsSpoilers: false, likeCount: { gte: 1 } },
    orderBy: [{ likeCount: 'desc' }, { createdAt: 'asc' }],
    select: reviewSelect,
  });
  return row ? toPublicReview(row) : null;
}
