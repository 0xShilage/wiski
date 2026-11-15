import 'server-only';
import type { ItemKind, Role } from '@/generated/prisma/client';
import { ITEM_KINDS, type ItemKindCode } from '@/lib/catalog/kinds';
import { MOVIE_MAX_RUNTIME } from '@/lib/catalog/pricing';
import { audit } from '../audit/audit';
import { db } from '../db';
import { HttpError, Problems } from '../http/problem';
import { logger } from '../log';
import { titleKeyOf } from '../suggestions/suggestions';
import { type FillFields, missingOf } from '../wikidata/parse';
import { type Candidate, searchWikidata, wikidataFill } from '../wikidata/wikidata';
import { createItemInput } from './input';
import {
  CatalogProblems,
  catalogTx,
  createItem,
  goLiveInTx,
  missingForPublish,
  refreshTotalAfter,
} from './service';

/**
 * Publishing helpers (2026-11-15, docs/phase-6/README.md §50):
 *  - quick add: a title (and year) → a draft filled from Wikidata ("Adicionar vários", one call
 *    per line so the page shows each line's progress);
 *  - "Criar rascunho" on a viewer suggestion: the same, linked to every viewer who asked for it;
 *  - "Agendar publicação": a complete movie draft goes live on its own at a set time (worker).
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

export const PublishingProblems = {
  exists: (title: string) =>
    new HttpError(409, 'ALREADY_IN_CATALOG', `“${title}” já está no catálogo.`),
  game: () =>
    new HttpError(409, 'NOT_A_CATALOG_KIND', 'Jogos não entram no catálogo de filmes e séries.'),
  scheduleRange: () =>
    Problems.validation([
      { path: 'publishAt', message: 'Escolha um horário entre daqui a 2 minutos e 90 dias.' },
    ]),
};

/** Placeholder runtime when Wikidata has none (a draft needs one); the result says so. */
const FALLBACK_RUNTIME: Record<ItemKindCode, number> = {
  MOVIE: 120,
  SERIES: 600,
  ANIME: 300,
  FRANCHISE: 240,
};

export type QuickAddResult = {
  itemId: string;
  title: string;
  /** the Wikidata item used, or null (not found / Wikidata down: only the title was kept) */
  wikidataId: string | null;
  /** what the draft still lacks besides images and synopsis, in Portuguese */
  missing: string[];
  existed: boolean;
};

/** Best match: the exact title (and year) first, then the year, then Wikidata's own order. */
export function pickCandidate(
  list: readonly Candidate[],
  title: string,
  year: number | null | undefined,
): Candidate | null {
  if (!list.length) return null;
  const key = titleKeyOf(title);
  const exact = list.filter((c) => titleKeyOf(c.title) === key);
  const byYear = (l: readonly Candidate[]) => (year ? l.find((c) => c.year === year) : undefined);
  if (year) {
    // a different year is a different film (a remake); a result without a year can still be it
    return byYear(exact) ?? byYear(list) ?? exact.find((c) => c.year === null) ?? null;
  }
  return exact[0] ?? list[0] ?? null;
}

/** A live or draft item of this kind that is already the same title (archived ones don't count). */
async function existing(
  kind: ItemKind,
  wikidataId: string | null,
  title: string,
  year: number | null,
) {
  if (wikidataId) {
    const same = await db().catalogItem.findFirst({
      where: { kind, wikidataId, status: { not: 'ARCHIVED' } },
      select: { id: true, title: true },
    });
    if (same) return same;
  }
  const key = titleKeyOf(title);
  const rows = await db().catalogItem.findMany({
    where: { kind, status: { not: 'ARCHIVED' } },
    select: { id: true, title: true, year: true },
    take: 300,
  });
  return (
    rows.find(
      (r) => titleKeyOf(r.title) === key && (year === null || r.year === null || r.year === year),
    ) ?? null
  );
}

function fieldsFor(kind: ItemKindCode, f: FillFields, wikidataId: string) {
  const episodic = kind === 'SERIES' || kind === 'ANIME';
  const entries = f.franchiseEntries
    .filter((e) => e.runtimeMinutes !== null)
    .map((e) => ({
      title: e.title,
      ...(e.year ? { year: e.year } : {}),
      runtimeMinutes: e.runtimeMinutes!,
    }));
  return {
    title: f.title,
    originalTitle: f.originalTitle,
    year: f.year,
    ageRating: f.ageRating,
    genres: f.genres,
    director: f.director,
    cast: f.cast,
    trailer: f.trailer,
    wikidataId,
    ...(episodic
      ? { seasonCount: f.seasonCount, episodeCount: f.episodeCount, seasonsLabel: f.seasonsLabel }
      : {}),
    ...(kind === 'FRANCHISE' ? { franchiseEntries: entries.slice(0, 30) } : {}),
  };
}

/**
 * One title → a draft. With a picked Wikidata id that item is used; otherwise the best search
 * match. Wikidata down or no match: the draft is made from the title alone (and says so).
 * Already in the catalog: 409, or the existing item when `onExisting` is 'return'.
 */
export async function quickAdd(
  ctx: Ctx,
  input: {
    kind: ItemKindCode;
    title: string;
    year?: number | null | undefined;
    wikidataId?: string | undefined;
  },
  opts: { source: 'bulk' | 'suggestion'; onExisting?: 'throw' | 'return' } = { source: 'bulk' },
): Promise<QuickAddResult> {
  const { kind } = input;
  const year = input.year ?? null;
  let fill: Awaited<ReturnType<typeof wikidataFill>> | null = null;
  let lookupFailed = false;
  try {
    let id = input.wikidataId ?? null;
    if (!id)
      id = pickCandidate(await searchWikidata(input.title, kind), input.title, year)?.id ?? null;
    if (id) fill = await wikidataFill(id, kind);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    lookupFailed = err.code === 'WIKIDATA_UNAVAILABLE';
    logger.info({ code: err.code }, 'quick add without Wikidata');
  }

  const title = fill?.fields.title || input.title;
  const same = await existing(kind, fill?.id ?? null, title, fill?.fields.year ?? year);
  if (same) {
    if (opts.onExisting !== 'return') throw PublishingProblems.exists(same.title);
    return {
      itemId: same.id,
      title: same.title,
      wikidataId: fill?.id ?? null,
      missing: [],
      existed: true,
    };
  }

  const runtime =
    kind === 'FRANCHISE'
      ? null
      : (fill?.fields.runtimeMinutes ?? null) !== null &&
          (kind !== 'MOVIE' || fill!.fields.runtimeMinutes! <= MOVIE_MAX_RUNTIME)
        ? fill!.fields.runtimeMinutes
        : null;
  const base = {
    kind,
    title,
    year: fill?.fields.year ?? year,
    runtimeMinutes: runtime ?? FALLBACK_RUNTIME[kind],
  };
  const full = fill ? { ...fieldsFor(kind, fill.fields, fill.id), ...base } : base;
  // the same validation (and sanitising) as the editor's own create; a field Wikidata got wrong
  // never blocks the draft — it is made from the title, year and runtime instead
  let parsed = createItemInput.safeParse(full);
  if (!parsed.success) parsed = createItemInput.safeParse(base);
  if (!parsed.success) throw Problems.validation([{ path: 'title', message: 'Título inválido.' }]);
  const item = await createItem(ctx, parsed.data, opts.source);

  const missing = fill
    ? missingOf(fill.fields, kind).map((m) =>
        m === 'duração' ? `duração (${FALLBACK_RUNTIME[kind]} min provisório)` : m,
      )
    : [
        lookupFailed
          ? 'Wikidata fora do ar: só o título'
          : 'não encontrado no Wikidata: só o título',
      ];
  return {
    itemId: item.id,
    title: item.title,
    wikidataId: fill?.id ?? null,
    missing,
    existed: false,
  };
}

/**
 * "Criar rascunho" on a suggestion: a filled draft (or the one already in the catalog), linked
 * to this suggestion and to every other viewer's waiting suggestion of the same title, which are
 * accepted in the same transaction. Calling it again returns the same draft.
 */
export async function draftFromSuggestion(ctx: Ctx, suggestionId: string) {
  const s = await db().suggestion.findUnique({
    where: { id: suggestionId },
    select: {
      id: true,
      kind: true,
      title: true,
      titleKey: true,
      year: true,
      item: { select: { id: true, title: true, status: true } },
    },
  });
  if (!s) throw Problems.notFound();
  if (s.item && s.item.status !== 'ARCHIVED') {
    return { itemId: s.item.id, title: s.item.title, missing: [], existed: true, linked: 0 };
  }
  const kind = s.kind;
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) throw PublishingProblems.game();
  const made = await quickAdd(
    ctx,
    { kind: kind as ItemKindCode, title: s.title, year: s.year },
    { source: 'suggestion', onExisting: 'return' },
  );
  const now = new Date();
  const linked = await db().$transaction(async (t) => {
    const accepted = await t.suggestion.updateMany({
      where: { titleKey: s.titleKey, kind: s.kind, status: 'NEW' },
      data: {
        status: 'ACCEPTED',
        reviewedAt: now,
        reviewedById: ctx.actor.id,
        itemId: made.itemId,
      },
    });
    // this one too, whatever its status (an accepted or dismissed one can still get its draft)
    await t.suggestion.updateMany({ where: { id: s.id }, data: { itemId: made.itemId } });
    const count = Math.max(1, accepted.count);
    await audit(
      {
        action: 'suggestion.draft',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Suggestion',
        targetId: s.id,
        metadata: { itemId: made.itemId, existed: made.existed, suggestions: count },
      },
      t,
    );
    return count;
  });
  return { ...made, linked };
}

// ── scheduled publishing ──

const MIN_AHEAD_MS = 2 * 60_000;
const MAX_AHEAD_MS = 90 * 86_400_000;

/** Set (or cancel, with null) the time a complete movie draft goes live on its own. */
export async function scheduleMovie(
  ctx: Ctx,
  id: string,
  input: { expectedVersion: number; publishAt: string | null },
  now = new Date(),
) {
  const item = await db().catalogItem.findUnique({ where: { id } });
  if (!item) throw Problems.notFound();
  if (item.kind !== 'MOVIE') {
    throw CatalogProblems.invalidState(
      'Só filmes podem ser agendados: séries e franquias entram no ar pela campanha.',
    );
  }
  if (item.status !== 'DRAFT') throw CatalogProblems.invalidState('Este filme já está no ar.');
  if (item.version !== input.expectedVersion) throw CatalogProblems.versionConflict(item.version);
  const at = input.publishAt === null ? null : new Date(input.publishAt);
  if (at) {
    const ahead = at.getTime() - now.getTime();
    if (!(ahead >= MIN_AHEAD_MS - 30_000 && ahead <= MAX_AHEAD_MS)) {
      throw PublishingProblems.scheduleRange();
    }
    const entries = await db().franchiseEntry.count({ where: { franchiseId: id } });
    const miss = missingForPublish(item, entries);
    if (miss.length) throw CatalogProblems.incomplete(miss);
  }
  await db().$transaction(async (t) => {
    const res = await t.catalogItem.updateMany({
      where: { id, status: 'DRAFT', version: input.expectedVersion },
      data: { publishAt: at, publishError: null },
    });
    if (res.count !== 1) throw CatalogProblems.versionConflict(item.version);
    await audit(
      {
        action: 'catalog.schedule',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'CatalogItem',
        targetId: id,
        metadata: { kind: 'MOVIE', publishAt: at?.toISOString() ?? null, version: item.version },
      },
      t,
    );
  });
}

const FAIL_CODES = new Set(['INCOMPLETE', 'CATALOG_FULL', 'SLOT_TAKEN', 'INVALID_STATE']);

/**
 * Worker ("catalog.scheduled", every minute): movie drafts whose time has come go live, in the
 * order they were scheduled. Their planned slot if free, else the first free one. A draft that
 * can't go live (incomplete after an edit, catalog full) is unscheduled with the reason, which the
 * dashboard shows; someone editing it at that very moment just makes it wait for the next round.
 */
export async function publishScheduled(now = new Date()): Promise<number> {
  const due = await db().catalogItem.findMany({
    where: { kind: 'MOVIE', status: 'DRAFT', publishAt: { lte: now } },
    orderBy: { publishAt: 'asc' },
    take: 10,
  });
  let done = 0;
  for (const item of due) {
    const attempt = (slot: number | null) =>
      catalogTx('MOVIE', async (t) => {
        const finalSlot = await goLiveInTx(t, { ...item, slot }, undefined, now);
        await audit(
          {
            action: 'catalog.publish',
            actor: null,
            requestId: null,
            targetType: 'CatalogItem',
            targetId: item.id,
            metadata: { kind: 'MOVIE', slot: finalSlot, version: item.version, scheduled: true },
          },
          t,
        );
      });
    try {
      try {
        await refreshTotalAfter(attempt(item.slot));
      } catch (err) {
        // the planned slot was taken meanwhile: any free one will do
        if (!(err instanceof HttpError && err.code === 'SLOT_TAKEN' && item.slot)) throw err;
        await refreshTotalAfter(attempt(null));
      }
      done += 1;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      if (err.code === 'VERSION_CONFLICT') continue; // edited right now: next round
      const code = FAIL_CODES.has(err.code)
        ? (err.code as 'INCOMPLETE' | 'CATALOG_FULL' | 'SLOT_TAKEN' | 'INVALID_STATE')
        : 'OTHER';
      const detail =
        code === 'INCOMPLETE'
          ? `Faltavam campos: ${(err.extra.errors ?? []).map((e) => e.message.replace(/\.$/, '').toLowerCase()).join(' · ')}.`
          : err.detail;
      await db().$transaction(async (t) => {
        const res = await t.catalogItem.updateMany({
          where: { id: item.id, status: 'DRAFT', publishAt: { not: null } },
          data: { publishAt: null, publishError: Array.from(detail).slice(0, 300).join('') },
        });
        if (res.count !== 1) return;
        await audit(
          {
            action: 'catalog.scheduleFailed',
            actor: null,
            requestId: null,
            targetType: 'CatalogItem',
            targetId: item.id,
            metadata: { kind: 'MOVIE', code },
          },
          t,
        );
      });
      logger.warn({ itemId: item.id, code }, 'scheduled publish failed');
    }
  }
  return done;
}
