import 'server-only';
import type { AgeRatingCode } from '@/lib/catalog/age-rating';
import type { ItemKindCode } from '@/lib/catalog/kinds';
import { MOVIE_MAX_RUNTIME } from '@/lib/catalog/pricing';
import { codePointLength, plainText } from '../text/sanitize';

/**
 * Reading Wikidata's JSON (2026-11-15): pure functions over the `wbgetentities` / search answers,
 * so the network code stays small and the parsing is unit-tested on fixtures. Everything that
 * leaves here is sanitised plain text, clipped to the catalog's own limits. Wikidata's data is
 * CC0 (public domain): no licence fee, no attribution required.
 */

export const QID = /^Q[1-9]\d{0,11}$/;

/** Classes ("instance of", P31) searched for each kind, so a search for a movie finds films. */
export const KIND_CLASSES: Record<ItemKindCode, readonly string[]> = {
  MOVIE: [
    'Q11424', // film
    'Q24869', // feature film
    'Q202866', // animated film
    'Q29168811', // animated feature film
    'Q506240', // television film
    'Q93204', // documentary film
    'Q20650540', // anime film
    'Q226730', // silent film
    'Q24862', // short film
  ],
  SERIES: [
    'Q5398426', // television series
    'Q1259759', // miniseries
    'Q581714', // animated series
    'Q117467246', // animated television series
    'Q526877', // web series
    'Q63952888', // anime television series
  ],
  ANIME: [
    'Q63952888', // anime television series
    'Q1107', // anime
    'Q220898', // original video animation
    'Q20650540', // anime film
    'Q581714', // animated series
    'Q117467246', // animated television series
    'Q5398426', // television series
  ],
  FRANCHISE: [
    'Q24856', // film series
    'Q196600', // media franchise
    'Q7725310', // series of creative works
  ],
};
const FILM_CLASSES = new Set(KIND_CLASSES.MOVIE);

// ── the JSON shapes we read (everything optional: the data is crowd-edited) ──

type DataValue = { type?: string; value?: unknown };
type Snak = { snaktype?: string; datavalue?: DataValue };
type Statement = { mainsnak?: Snak; rank?: string; qualifiers?: Record<string, Snak[]> };
type LangText = { language?: string; value?: string };
export type Entity = {
  id?: string;
  missing?: string;
  labels?: Record<string, LangText>;
  descriptions?: Record<string, LangText>;
  claims?: Record<string, Statement[]>;
  sitelinks?: Record<string, { site?: string; title?: string }>;
};

const LABEL_LANGS = ['pt', 'pt-br', 'mul', 'en'] as const;

function clip(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = plainText(raw, { multiline: false });
  if (!s) return null;
  return codePointLength(s) <= max ? s : Array.from(s).slice(0, max).join('').trim();
}

/** The best label: Portuguese first, then the language-neutral name, then English. */
export function labelOf(e: Entity | undefined, langs: readonly string[] = LABEL_LANGS) {
  for (const l of langs) {
    const v = e?.labels?.[l]?.value;
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/** Statements of a property: deprecated ones dropped, preferred ones first, then the rest in order. */
export function statements(e: Entity | undefined, p: string): Statement[] {
  const all = (e?.claims?.[p] ?? []).filter(
    (s) => s?.rank !== 'deprecated' && s?.mainsnak?.snaktype === 'value',
  );
  return [
    ...all.filter((s) => s.rank === 'preferred'),
    ...all.filter((s) => s.rank !== 'preferred'),
  ];
}

function itemIdOf(s: Snak | undefined): string | null {
  const v = s?.datavalue?.value as { id?: unknown } | undefined;
  return typeof v?.id === 'string' && QID.test(v.id) ? v.id : null;
}

/** Item ids a property points to (deduplicated, in order). */
export function itemIds(e: Entity | undefined, p: string, max = 50): string[] {
  const out: string[] = [];
  for (const s of statements(e, p)) {
    const id = itemIdOf(s.mainsnak);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function quantity(s: Statement): { amount: number; unit: string } | null {
  const v = s.mainsnak?.datavalue?.value as { amount?: unknown; unit?: unknown } | undefined;
  const amount = typeof v?.amount === 'string' ? Number(v.amount) : Number.NaN;
  if (!Number.isFinite(amount)) return null;
  const unit = typeof v?.unit === 'string' ? (v.unit.split('/').pop() ?? '1') : '1';
  return { amount, unit };
}

const TO_MINUTES: Record<string, number> = { Q7727: 1, Q25235: 60, Q11574: 1 / 60 };

/** Duration (P2047) in whole minutes, or null. */
export function durationMinutes(e: Entity | undefined): number | null {
  for (const s of statements(e, 'P2047')) {
    const q = quantity(s);
    const k = q ? TO_MINUTES[q.unit] : undefined;
    if (!q || k === undefined) continue;
    const min = Math.round(q.amount * k);
    if (min >= 1 && min <= 20_000) return min;
  }
  return null;
}

/** A whole number (seasons P2437, episodes P1113), or null. */
export function count(e: Entity | undefined, p: string): number | null {
  for (const s of statements(e, p)) {
    const q = quantity(s);
    if (q && Number.isInteger(q.amount) && q.amount >= 1 && q.amount <= 10_000) return q.amount;
  }
  return null;
}

/** The earliest year of a publication date (P577), or null. */
export function firstYear(e: Entity | undefined): number | null {
  let best: number | null = null;
  for (const s of statements(e, 'P577')) {
    const v = s.mainsnak?.datavalue?.value as { time?: unknown; precision?: unknown } | undefined;
    if (typeof v?.time !== 'string' || (typeof v.precision === 'number' && v.precision < 9)) {
      continue;
    }
    const m = /^\+(\d{4})-/.exec(v.time);
    const y = m ? Number(m[1]) : Number.NaN;
    if (y >= 1888 && y <= 2100 && (best === null || y < best)) best = y;
  }
  return best;
}

/** The original title (P1476), whatever its language. */
export function originalTitleOf(e: Entity | undefined): string | null {
  for (const s of statements(e, 'P1476')) {
    const v = s.mainsnak?.datavalue?.value as { text?: unknown } | undefined;
    const t = clip(v?.text, 120);
    if (t) return t;
  }
  return null;
}

const YT = /^[\w-]{11}$/;
const ROLE_TRAILER = 'Q622550';
const PT_LANGS = new Set(['Q750553', 'Q5146']); // Brazilian Portuguese, Portuguese

/**
 * The trailer (P1651, YouTube video id): one marked as a trailer (P3831 = trailer) first, a
 * Portuguese one before others; a video marked with any other role (the whole film, a clip) is
 * never used.
 */
export function trailerOf(e: Entity | undefined): string | null {
  const ranked: { id: string; score: number }[] = [];
  for (const s of statements(e, 'P1651')) {
    const id = s.mainsnak?.datavalue?.value;
    if (typeof id !== 'string' || !YT.test(id)) continue;
    const roles = (s.qualifiers?.P3831 ?? []).map(itemIdOf).filter(Boolean);
    if (roles.length && !roles.includes(ROLE_TRAILER)) continue;
    const langs = (s.qualifiers?.P407 ?? []).map(itemIdOf);
    const score =
      (roles.includes(ROLE_TRAILER) ? 2 : 0) + (langs.some((l) => l && PT_LANGS.has(l)) ? 1 : 0);
    ranked.push({ id, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.id ?? null;
}

/** "filme de ficção científica" → "Ficção científica"; "série de televisão de drama" → "Drama". */
export function genreName(label: string): string | null {
  const s = label
    .trim()
    .replace(
      /^(?:filmes?|cinema|longa-metragem|séries?(?: de televisão| televisiva| de tv)?|seriado|anime|desenho animado|telenovela)\s+(?:(?:de|do|da|dos|das)\s+)?/i,
      '',
    )
    .trim();
  if (!s || /^(?:filme|série|anime)$/i.test(s)) return null;
  const out = s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);
  return clip(out, 32);
}

/** A ClassInd rating item's label ("ClassInd 14", "L", "Livre", …) → the catalog's code. */
export function ageRatingFromLabel(label: string | null): AgeRatingCode | null {
  if (!label) return null;
  const n = /\b(10|12|14|16|18)\b/.exec(label)?.[1];
  if (n) return `A${n}` as AgeRatingCode;
  if (/\b(?:L|AL|ER)\b|livre|general/i.test(label)) return 'L';
  return null;
}

/** The year a search result's description mentions ("filme de 1999 dirigido por …"). */
export function yearInText(text: string | null | undefined): number | null {
  const m = text ? /\b(1[89]\d{2}|20\d{2})\b/.exec(text) : null;
  const y = m ? Number(m[1]) : null;
  return y && y >= 1888 && y <= 2100 ? y : null;
}

export function isFilm(e: Entity | undefined): boolean {
  return itemIds(e, 'P31').some((c) => FILM_CLASSES.has(c));
}

// ── the fill ──

export type FillEntry = { title: string; year: number | null; runtimeMinutes: number | null };

/** What the editor fills in (plain, sanitised, within the catalog's limits). */
export type FillFields = {
  title: string;
  originalTitle: string | null;
  year: number | null;
  runtimeMinutes: number | null;
  ageRating: AgeRatingCode | null;
  genres: string[];
  director: string | null;
  cast: string[];
  trailer: string | null;
  seasonCount: number | null;
  episodeCount: number | null;
  seasonsLabel: string | null;
  franchiseEntries: FillEntry[];
};

/** Labels of the items a film points to (directors, cast, genres, ratings, parts). */
export type Labels = Map<string, Entity>;

export const CAST_MAX = 6;
export const DIRECTORS_MAX = 3;
export const GENRES_MAX = 6;
export const PARTS_MAX = 12;

/** The ids whose labels the fill needs (one more request). */
export function referencedIds(e: Entity, kind: ItemKindCode): string[] {
  return [
    ...new Set([
      ...itemIds(e, 'P57', DIRECTORS_MAX),
      ...itemIds(e, 'P161', CAST_MAX),
      ...itemIds(e, 'P136', 12),
      ...itemIds(e, 'P3216', 3),
      ...(kind === 'FRANCHISE' ? itemIds(e, 'P527', PARTS_MAX) : []),
    ]),
  ];
}

function dedupe(list: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    const k = v.toLocaleLowerCase('pt-BR');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export function fillFrom(e: Entity, kind: ItemKindCode, labels: Labels): FillFields {
  const name = (id: string) => clip(labelOf(labels.get(id)), 60);
  const original = originalTitleOf(e);
  const title = clip(labelOf(e), 120) ?? original ?? '';
  const year = firstYear(e);

  let runtime = durationMinutes(e);
  const seasonCount = kind === 'SERIES' || kind === 'ANIME' ? count(e, 'P2437') : null;
  const episodeCount = kind === 'SERIES' || kind === 'ANIME' ? count(e, 'P1113') : null;
  if ((kind === 'SERIES' || kind === 'ANIME') && runtime !== null) {
    // a series' duration is an episode's; the catalog wants the whole thing
    runtime = episodeCount ? Math.min(20_000, runtime * episodeCount) : null;
  }
  if (kind === 'MOVIE' && runtime !== null && runtime > MOVIE_MAX_RUNTIME) runtime = null;

  const directors = itemIds(e, 'P57', DIRECTORS_MAX)
    .map(name)
    .filter((n): n is string => !!n);
  const director = directors.length ? clip(directors.join(', '), 160) : null;
  const cast = dedupe(
    itemIds(e, 'P161', CAST_MAX)
      .map(name)
      .filter((n): n is string => !!n),
    CAST_MAX,
  );
  const genres = dedupe(
    itemIds(e, 'P136', 12)
      .map((id) => labelOf(labels.get(id), ['pt', 'pt-br']))
      .map((l) => (l ? genreName(l) : null))
      .filter((g): g is string => !!g),
    GENRES_MAX,
  );
  let ageRating: AgeRatingCode | null = null;
  for (const id of itemIds(e, 'P3216', 3)) {
    ageRating = ageRatingFromLabel(labelOf(labels.get(id), ['pt', 'pt-br', 'mul', 'en']));
    if (ageRating) break;
  }

  const franchiseEntries: FillEntry[] =
    kind === 'FRANCHISE'
      ? itemIds(e, 'P527', PARTS_MAX)
          .map((id) => labels.get(id))
          .filter((p): p is Entity => !!p && isFilm(p))
          .map((p) => ({
            title: clip(labelOf(p), 120) ?? '',
            year: firstYear(p),
            runtimeMinutes: (() => {
              const m = durationMinutes(p);
              return m && m <= MOVIE_MAX_RUNTIME ? m : null;
            })(),
          }))
          .filter((p) => p.title)
          .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999))
      : [];

  return {
    title,
    originalTitle:
      original && original.toLocaleLowerCase('pt-BR') !== title.toLocaleLowerCase('pt-BR')
        ? original
        : null,
    year,
    runtimeMinutes: runtime,
    ageRating,
    genres,
    director,
    cast,
    trailer: trailerOf(e),
    seasonCount,
    episodeCount,
    seasonsLabel: seasonCount
      ? seasonCount === 1
        ? 'Temporada 1'
        : `Temporadas 1–${seasonCount}`
      : null,
    franchiseEntries,
  };
}

/** Which fields a fill found, in Portuguese (shown after a quick add). */
export function missingOf(f: FillFields, kind: ItemKindCode): string[] {
  const miss: string[] = [];
  if (!f.year) miss.push('ano');
  if (kind !== 'FRANCHISE' && !f.runtimeMinutes) miss.push('duração');
  if (!f.ageRating) miss.push('classificação');
  if (!f.genres.length) miss.push('gêneros');
  if (kind === 'FRANCHISE' && f.franchiseEntries.length < 2) miss.push('filmes da franquia');
  return miss;
}

export { clip as clipText };
