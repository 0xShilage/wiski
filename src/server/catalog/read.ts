import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { ItemKind } from '@/generated/prisma/enums';
import type { PublicItem, PublicState } from '@/lib/catalog/types';
import { LIVE_STATUSES, PUBLIC_STATUSES, QUEUE_STATUSES } from '@/lib/catalog/kinds';
import { moviePriceCents, movieListPriceCents } from '@/lib/catalog/pricing';
import { pictureFrom } from '@/lib/media';
import { ensureAccent } from '../media/accent';
import { ensurePalette } from '../media/palette';
import { matchesSearch, searchTerms } from '@/lib/search';
import { db } from '../db';
import { campaignState, formulaGoal } from './campaigns';
import { missingForPublish } from './service';
import type { TrailPart } from '@/lib/trail';

export type { PublicCampaign, PublicItem, PublicState } from '@/lib/catalog/types';

/** Read models for the public pages/API and for the dashboard. Never exposes internal ids of
 *  users, order data, or anything the visitor shouldn't see. */

const mediaSelect = { select: { width: true, height: true, variants: true } } as const;
/** the detail page also needs the poster's accent (and its id, to fill it in once) */
const posterSelect = {
  select: { id: true, accent: true, palette: true, width: true, height: true, variants: true },
} as const;
const SPONSOR_ORDER_STATUSES = ['PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED'] as const;

const publicInclude = {
  poster: mediaSelect,
  backdrop: mediaSelect,
  logo: mediaSelect,
  campaign: true,
  franchiseEntries: { orderBy: { position: 'asc' } },
  orders: {
    where: { kind: 'MOVIE', status: { in: [...SPONSOR_ORDER_STATUSES] } },
    take: 1,
    select: {
      showSponsorName: true,
      guestDisplayName: true,
      displayNameStatus: true,
      user: { select: { username: true } },
    },
  },
} satisfies Prisma.CatalogItemInclude;

type PublicRow = Prisma.CatalogItemGetPayload<{ include: typeof publicInclude }>;

function sponsorName(row: PublicRow): string | null {
  const o = row.orders[0];
  if (!o || !o.showSponsorName) return null;
  if (o.user?.username) return `@${o.user.username}`;
  if (o.guestDisplayName && o.displayNameStatus === 'APPROVED') return o.guestDisplayName;
  return null;
}

function toPublic(row: PublicRow, now: Date): PublicItem {
  const campaign = row.campaign
    ? {
        id: row.campaign.id,
        goalCents: row.campaign.goalCents,
        raisedCents: row.campaign.raisedCents,
        remainingCents: row.campaign.remainingCents,
        supporterCount: row.campaign.supporterCount,
        deadlineAt: row.campaign.deadlineAt.toISOString(),
        extensions: row.campaign.extensions,
        state: campaignState(row.campaign, now),
      }
    : null;
  let state: PublicState =
    row.status === 'SPONSORED'
      ? 'SPONSORED'
      : row.status === 'FUNDED'
        ? 'FUNDED'
        : row.status === 'WATCHED' || row.status === 'ARCHIVED'
          ? 'WATCHED' // ARCHIVED is only read publicly when it was watched (reviews stay)
          : 'ACTIVE';
  if (state === 'ACTIVE' && row.reservedUntil && row.reservedUntil > now) state = 'RESERVED';
  if (state === 'ACTIVE' && campaign?.state === 'PAUSED') state = 'PAUSED';
  return {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    slot: row.slot,
    title: row.title,
    originalTitle: row.originalTitle,
    year: row.year,
    runtimeMinutes: row.runtimeMinutes,
    ageRating: row.ageRating,
    genres: row.genres,
    synopsis: row.synopsis,
    director: row.director,
    cast: row.cast,
    seasonsLabel: row.seasonsLabel,
    seasonCount: row.seasonCount,
    episodeCount: row.episodeCount,
    trailerYoutubeId: row.trailerYoutubeId,
    posterTitle: row.posterTitle,
    poster: pictureFrom(row.poster),
    accent: null,
    palette: [],
    backdrop: pictureFrom(row.backdrop),
    logo: pictureFrom(row.logo),
    state,
    watchedAt: row.watchedAt?.toISOString() ?? null,
    offStream: row.offStream,
    parts: [],
    priceCents:
      row.kind === 'MOVIE' ? movieListPriceCents(row.runtimeMinutes, row.manualPriceCents) : null,
    manualPrice: row.kind === 'MOVIE' && row.manualPriceCents !== null,
    sponsorName: row.status === 'SPONSORED' ? sponsorName(row) : null,
    campaign,
    films: row.franchiseEntries.map(({ position, title, year, runtimeMinutes }) => ({
      position,
      title,
      year,
      runtimeMinutes,
    })),
  };
}

/** Live items of a kind in slot order (the carousel / campaign grid). */
export async function listPublic(kind: ItemKind, now = new Date()): Promise<PublicItem[]> {
  const rows = await db().catalogItem.findMany({
    where: { kind, status: { in: [...PUBLIC_STATUSES] } },
    orderBy: { slot: 'asc' },
    include: publicInclude,
  });
  return rows.map((r) => toPublic(r, now));
}

/** Detail page: live or already watched — also after the slot was replaced (ARCHIVED), so a
 *  watched title keeps its page and its reviews. */
export async function getPublic(kind: ItemKind, slug: string, now = new Date()) {
  const row = await db().catalogItem.findFirst({
    where: {
      kind,
      slug,
      OR: [
        { status: { in: [...PUBLIC_STATUSES, ...QUEUE_STATUSES, 'WATCHED'] } },
        { status: 'ARCHIVED', watchedAt: { not: null } },
      ],
    },
    include: { ...publicInclude, poster: posterSelect },
  });
  if (!row) return null;
  // the ambient glow (2026-11-11): older posters get their colour the first time it's needed
  const [accent, palette] = row.poster
    ? await Promise.all([ensureAccent(row.poster), ensurePalette(row.poster)])
    : [null, []];
  const parts = row.kind === 'MOVIE' ? [] : await trailParts(row.id);
  return { ...toPublic(row, now), accent, palette, parts };
}

/** Watched titles for Avaliações (newest first). */
export async function listWatched(limit = 24, now = new Date()) {
  const rows = await db().catalogItem.findMany({
    where: { status: { in: ['WATCHED', 'ARCHIVED'] }, watchedAt: { not: null } },
    orderBy: { watchedAt: 'desc' },
    take: limit,
    include: publicInclude,
  });
  return rows.map((r) => ({ ...toPublic(r, now), watchedAt: r.watchedAt!.toISOString() }));
}

/** Assistidos (2026-11-01): every title watched on stream, newest first, optionally one kind. */
/**
 * Everything already watched, newest first (/assistidos). With a search (2026-11-03), the title
 * and original title must contain every word, ignoring case and accents; the whole history is
 * searched (up to WATCHED_SEARCH_CAP rows) and the first `limit` matches returned.
 */
const WATCHED_SEARCH_CAP = 2000;

export async function watchedTitles(
  kind?: ItemKind,
  query?: string | null,
  limit = 120,
  now = new Date(),
) {
  const terms = searchTerms(query);
  const rows = await db().catalogItem.findMany({
    where: {
      status: { in: ['WATCHED', 'ARCHIVED'] },
      watchedAt: { not: null },
      ...(kind ? { kind } : {}),
    },
    orderBy: { watchedAt: 'desc' },
    take: terms.length ? WATCHED_SEARCH_CAP : limit,
    include: publicInclude,
  });
  return rows
    .filter((r) => matchesSearch([r.title, r.originalTitle], terms))
    .slice(0, limit)
    .map((r) => ({ ...toPublic(r, now), watchedAt: r.watchedAt!.toISOString() }));
}

export async function getPublicCampaign(id: string, now = new Date()) {
  const c = await db().campaign.findUnique({
    where: { id },
    include: { item: { select: { slug: true, kind: true, title: true, status: true } } },
  });
  if (!c || c.item.status === 'DRAFT' || c.item.status === 'ARCHIVED') return null;
  return {
    id: c.id,
    item: { slug: c.item.slug, kind: c.item.kind, title: c.item.title },
    goalCents: c.goalCents,
    raisedCents: c.raisedCents,
    remainingCents: c.remainingCents,
    supporterCount: c.supporterCount,
    deadlineAt: c.deadlineAt.toISOString(),
    extensions: c.extensions,
    state: campaignState(c, now),
  };
}

// ── dashboard ───────────────────────────────────────────────────────────────────

export async function adminCounts() {
  const rows = await db().catalogItem.groupBy({
    by: ['kind'],
    where: { status: { in: [...LIVE_STATUSES] } },
    _count: { _all: true },
  });
  const out = { MOVIE: 0, SERIES: 0, FRANCHISE: 0 } as Record<ItemKind, number>;
  for (const r of rows) out[r.kind] = r._count._all;
  return out;
}

export type AdminListItem = Awaited<ReturnType<typeof listAdmin>>[number];

/** Board + drafts for one kind (archived items are not listed). */
export async function listAdmin(kind: ItemKind, now = new Date()) {
  const rows = await db().catalogItem.findMany({
    where: { kind, status: { not: 'ARCHIVED' } },
    orderBy: [{ slot: 'asc' }, { updatedAt: 'desc' }],
    include: { poster: mediaSelect, campaign: true },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    slug: r.slug,
    status: r.status,
    slot: r.slot,
    title: r.title,
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
    reserved: !!r.reservedUntil && r.reservedUntil > now,
    poster: pictureFrom(r.poster),
    campaign: r.campaign
      ? {
          state: campaignState(r.campaign, now),
          goalCents: r.campaign.goalCents,
          raisedCents: r.campaign.raisedCents,
        }
      : null,
  }));
}

export async function getAdmin(id: string, now = new Date()) {
  const row = await db().catalogItem.findUnique({
    where: { id },
    include: {
      poster: mediaSelect,
      backdrop: mediaSelect,
      logo: mediaSelect,
      campaign: true,
      franchiseEntries: { orderBy: { position: 'asc' } },
      revisions: {
        orderBy: { version: 'desc' },
        take: 20,
        select: {
          version: true,
          note: true,
          createdAt: true,
          editor: { select: { username: true } },
        },
      },
    },
  });
  if (!row) return null;
  const entries = row.franchiseEntries.length;
  return {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    status: row.status,
    slot: row.slot,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    reserved: !!row.reservedUntil && row.reservedUntil > now,
    fields: {
      title: row.title,
      originalTitle: row.originalTitle,
      year: row.year,
      runtimeMinutes: row.runtimeMinutes,
      ageRating: row.ageRating,
      genres: row.genres,
      synopsis: row.synopsis,
      director: row.director,
      cast: row.cast,
      seasonsLabel: row.seasonsLabel,
      seasonCount: row.seasonCount,
      episodeCount: row.episodeCount,
      trailerYoutubeId: row.trailerYoutubeId,
      posterId: row.posterId,
      backdropId: row.backdropId,
      logoId: row.logoId,
      posterTitle: row.posterTitle,
      manualPriceCents: row.manualPriceCents,
      franchiseEntries: row.franchiseEntries.map(({ title, year, runtimeMinutes }) => ({
        title,
        year,
        runtimeMinutes,
      })),
    },
    media: {
      poster: pictureFrom(row.poster),
      backdrop: pictureFrom(row.backdrop),
      logo: pictureFrom(row.logo),
    },
    priceCents:
      row.kind !== 'MOVIE'
        ? null
        : row.manualPriceCents !== null
          ? row.manualPriceCents
          : row.runtimeMinutes >= 1 && row.runtimeMinutes <= 360
            ? moviePriceCents(row.runtimeMinutes)
            : null,
    formulaGoalCents: await formulaGoal(row),
    missing: row.status === 'DRAFT' ? missingForPublish(row, entries) : [],
    campaign: row.campaign
      ? {
          id: row.campaign.id,
          state: campaignState(row.campaign, now),
          goalCents: row.campaign.goalCents,
          raisedCents: row.campaign.raisedCents,
          reservedCents: row.campaign.reservedCents,
          deadlineAt: row.campaign.deadlineAt.toISOString(),
          extensions: row.campaign.extensions,
        }
      : null,
    revisions: row.revisions.map((r) => ({
      version: r.version,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      editor: r.editor.username ? `@${r.editor.username}` : 'moderação',
    })),
  };
}

export type AdminItem = NonNullable<Awaited<ReturnType<typeof getAdmin>>>;

/**
 * Trilha da maratona (2026-11-13): a series', anime's or franchise's parts on the Agenda — done
 * ones in the order they were shown, then the ones still to come by their live's start. Skipped
 * parts (the live ended first) are left out: they are booked again.
 */
async function trailParts(itemId: string): Promise<TrailPart[]> {
  const rows = await db().liveSegment.findMany({
    where: { kind: 'PART', campaign: { itemId }, status: { in: ['DONE', 'PLAYING', 'SCHEDULED'] } },
    select: {
      label: true,
      status: true,
      doneAt: true,
      episodeFrom: true,
      episodeTo: true,
      franchisePosition: true,
      session: { select: { startsAt: true } },
    },
  });
  const when = (r: (typeof rows)[number]) =>
    (r.status === 'DONE' ? (r.doneAt ?? r.session.startsAt) : r.session.startsAt).getTime();
  return rows
    .sort((a, b) => Number(b.status === 'DONE') - Number(a.status === 'DONE') || when(a) - when(b))
    .map((r) => ({
      label: r.label,
      status: r.status as TrailPart['status'],
      at: (r.status === 'DONE'
        ? (r.doneAt ?? r.session.startsAt)
        : r.session.startsAt
      ).toISOString(),
      episodes:
        r.episodeFrom !== null && r.episodeTo !== null ? r.episodeTo - r.episodeFrom + 1 : null,
      franchisePosition: r.franchisePosition,
    }));
}
