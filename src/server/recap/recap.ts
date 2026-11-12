import 'server-only';
import type { User } from '@/generated/prisma/client';
import { pictureFrom } from '@/lib/media';
import { type Recap, type RecapTitle, yearBounds } from '@/lib/recap';
import { badgesOf } from '../badges/badges';
import { COUNTED_ORDER_STATUSES } from '../community/achievements';
import { db } from '../db';

const WALL = 12;
const SHOWN = 6;

const titleSelect = {
  slug: true,
  title: true,
  kind: true,
  runtimeMinutes: true,
  watchedAt: true,
  offStream: true,
  poster: { select: { width: true, height: true, variants: true } },
} as const;

type TitleRow = {
  slug: string;
  title: string;
  kind: RecapTitle['kind'];
  poster: { width: number; height: number; variants: unknown } | null;
};

const asTitle = (r: TitleRow): RecapTitle => ({
  slug: r.slug,
  title: r.title,
  kind: r.kind,
  poster: pictureFrom(r.poster),
});

/** distinct by slug, first seen first */
function distinct<T extends { slug: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.slug) ? false : (seen.add(r.slug), true)));
}

/**
 * "Seu ano na Wiskiflix" (2026-11-12): what the live watched in a São Paulo calendar year and what
 * this viewer did in it — sponsorships and contributions (paid, anonymous ones included: the page
 * is theirs alone), reviews and the likes they got, suggestions, Roleta, badges. Never an amount.
 */
export async function recapFor(
  user: Pick<User, 'id' | 'username' | 'avatarKey' | 'createdAt'>,
  year: number,
  now = new Date(),
): Promise<Recap> {
  const { start, end } = yearBounds(year);
  const inYear = { gte: start, lt: end };
  const statuses = [...COUNTED_ORDER_STATUSES];
  const [
    watched,
    lives,
    orders,
    reviews,
    likesReceived,
    suggestions,
    taken,
    spins,
    prizes,
    badges,
  ] = await Promise.all([
    db().watchEvent.findMany({
      where: { watchedAt: inYear, item: { offStream: false } },
      orderBy: { watchedAt: 'asc' },
      select: { item: { select: titleSelect } },
    }),
    db().streamSession.count({ where: { status: 'DONE', startsAt: inYear } }),
    db().order.findMany({
      where: { userId: user.id, status: { in: statuses }, paidAt: inYear },
      orderBy: { paidAt: 'asc' },
      select: { kind: true, item: { select: titleSelect } },
    }),
    db().review.findMany({
      where: { userId: user.id, status: 'VISIBLE', createdAt: inYear },
      select: {
        rating: true,
        likeCount: true,
        item: { select: { slug: true, title: true } },
      },
    }),
    db().reviewLike.count({
      where: {
        createdAt: inYear,
        userId: { not: user.id },
        review: { userId: user.id, status: 'VISIBLE' },
      },
    }),
    db().suggestion.count({ where: { userId: user.id, createdAt: inYear } }),
    db().suggestion.count({
      where: { userId: user.id, createdAt: inYear, status: { in: ['ACCEPTED', 'WATCHED'] } },
    }),
    db().roletaSpin.count({ where: { userId: user.id, createdAt: inYear } }),
    db().roletaSpin.count({
      where: { userId: user.id, createdAt: inYear, prize: { not: 'NADA' } },
    }),
    badgesOf(user.id, now),
  ]);

  const site = distinct(watched.map((w) => w.item));
  const movies = site.filter((i) => i.kind === 'MOVIE');
  const sponsoredRows = distinct(orders.filter((o) => o.kind === 'MOVIE').map((o) => o.item));
  const supportedRows = distinct(
    orders.filter((o) => o.kind === 'CONTRIBUTION').map((o) => o.item),
  );
  const minutes = sponsoredRows
    .filter((i) => !i.offStream && i.watchedAt && i.watchedAt >= start && i.watchedAt < end)
    .reduce((sum, i) => sum + i.runtimeMinutes, 0);
  const top = reviews.reduce<(typeof reviews)[number] | null>(
    (best, r) => (r.likeCount > 0 && (!best || r.likeCount > best.likeCount) ? r : best),
    null,
  );
  const mineBadges = badges.filter((b) => {
    const at = b.claimedAt ? new Date(b.claimedAt) : null;
    return at !== null && at >= start && at < end;
  });

  return {
    year,
    username: user.username ?? '',
    avatarKey: user.avatarKey,
    memberSince: user.createdAt.toISOString(),
    site: {
      titles: site.length,
      movies: movies.length,
      series: site.length - movies.length,
      movieMinutes: movies.reduce((sum, i) => sum + i.runtimeMinutes, 0),
      lives,
      // the most recent first: the end of the year is the freshest memory
      wall: site.slice(-WALL).reverse().map(asTitle),
    },
    mine: {
      sponsorships: orders.filter((o) => o.kind === 'MOVIE').length,
      sponsored: sponsoredRows.slice(0, SHOWN).map(asTitle),
      contributions: orders.filter((o) => o.kind === 'CONTRIBUTION').length,
      supported: supportedRows.slice(0, SHOWN).map(asTitle),
      minutes,
      reviews: reviews.length,
      averageRating: reviews.length
        ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
        : null,
      likesReceived,
      topReview: top
        ? { title: top.item.title, slug: top.item.slug, likes: top.likeCount, rating: top.rating }
        : null,
      suggestions,
      suggestionsTaken: taken,
      spins,
      prizes,
      badges: mineBadges,
    },
  };
}
