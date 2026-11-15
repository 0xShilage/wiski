import { LIVE_LIMIT } from '@/lib/catalog/pricing';
import { isEpisodic } from '@/lib/catalog/kinds';
import { AGE_RATINGS, type AgeRatingCode } from '@/lib/catalog/age-rating';
import type { ItemKindCode } from '@/lib/catalog/kinds';
import type { AdminItem, AdminListItem } from '@/server/catalog/read';

export type { AdminItem, AdminListItem };
export type Kind = ItemKindCode;

/** Editor state: everything as typed (strings), converted to API fields on save. */
export type Form = {
  title: string;
  originalTitle: string;
  year: string;
  runtimeMinutes: string;
  ageRating: '' | AgeRatingCode;
  genres: string;
  synopsis: string;
  director: string;
  cast: string;
  trailer: string;
  seasonsLabel: string;
  seasonCount: string;
  episodeCount: string;
  posterId: string | null;
  backdropId: string | null;
  /** MOVIE (2026-11-14): up to four more backgrounds, in order */
  extraBackdropIds: string[];
  logoId: string | null;
  posterTitle: boolean;
  /** MOVIE: "60" or "59,90" (R$); empty = price by runtime */
  manualPrice: string;
  slot: string;
  films: { title: string; year: string; runtimeMinutes: string }[];
  /** the Wikidata item the fields were filled from (2026-11-15) */
  wikidataId: string | null;
};

export const emptyForm = (slot: number | null = null): Form => ({
  title: '',
  originalTitle: '',
  year: '',
  runtimeMinutes: '',
  ageRating: '',
  genres: '',
  synopsis: '',
  director: '',
  cast: '',
  trailer: '',
  seasonsLabel: '',
  seasonCount: '',
  episodeCount: '',
  posterId: null,
  backdropId: null,
  extraBackdropIds: [],
  logoId: null,
  posterTitle: true,
  manualPrice: '',
  slot: slot ? String(slot) : '',
  films: [],
  wikidataId: null,
});

export function formFrom(item: AdminItem): Form {
  const f = item.fields;
  return {
    title: f.title,
    originalTitle: f.originalTitle ?? '',
    year: f.year ? String(f.year) : '',
    runtimeMinutes: String(f.runtimeMinutes),
    ageRating: (f.ageRating ?? '') as Form['ageRating'],
    genres: f.genres.join(', '),
    synopsis: f.synopsis,
    director: f.director ?? '',
    cast: f.cast.join(', '),
    trailer: f.trailerYoutubeId ? `https://youtu.be/${f.trailerYoutubeId}` : '',
    seasonsLabel: f.seasonsLabel ?? '',
    seasonCount: f.seasonCount ? String(f.seasonCount) : '',
    episodeCount: f.episodeCount ? String(f.episodeCount) : '',
    posterId: f.posterId,
    backdropId: f.backdropId,
    extraBackdropIds: f.extraBackdropIds,
    logoId: f.logoId,
    posterTitle: f.posterTitle,
    manualPrice: f.manualPriceCents === null ? '' : centsToReais(f.manualPriceCents),
    slot: item.slot ? String(item.slot) : '',
    films: f.franchiseEntries.map((e) => ({
      title: e.title,
      year: e.year ? String(e.year) : '',
      runtimeMinutes: String(e.runtimeMinutes),
    })),
    wikidataId: f.wikidataId,
  };
}

/** 6000 → "60"; 5990 → "59,90" (what the editor's price field shows). */
export function centsToReais(cents: number): string {
  const r = Math.floor(cents / 100);
  const c = cents % 100;
  return c ? `${r},${String(c).padStart(2, '0')}` : String(r);
}

/** "60", "59,90", "R$ 59.9" → cents; "" → null; anything else → NaN (the editor refuses it). */
export function reaisToCents(s: string): number | null {
  const t = s.replace(/^\s*R\$\s*/i, '').trim();
  if (!t) return null;
  const m = /^(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

const int = (s: string): number | null => (/^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : null);
const list = (s: string) =>
  s
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/** API `fields` for a save (the server sanitises and validates everything again). */
export function fieldsFrom(form: Form, kind: Kind, draft: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    title: form.title,
    originalTitle: form.originalTitle || null,
    year: int(form.year),
    ageRating: AGE_RATINGS.includes(form.ageRating as AgeRatingCode) ? form.ageRating : null,
    genres: list(form.genres),
    synopsis: form.synopsis,
    director: form.director || null,
    cast: list(form.cast),
    trailer: form.trailer.trim() || null,
    posterId: form.posterId,
    backdropId: form.backdropId,
    logoId: form.logoId,
    wikidataId: form.wikidataId,
  };
  if (kind === 'MOVIE') {
    // the extras only make sense after a main background
    out.extraBackdropIds = form.backdropId ? form.extraBackdropIds : [];
    out.posterTitle = form.posterTitle;
    out.manualPriceCents = reaisToCents(form.manualPrice);
  }
  if (kind !== 'FRANCHISE') {
    const r = int(form.runtimeMinutes);
    if (r) out.runtimeMinutes = r;
  }
  if (isEpisodic(kind)) {
    out.seasonsLabel = form.seasonsLabel || null;
    out.seasonCount = int(form.seasonCount);
    out.episodeCount = int(form.episodeCount);
  }
  if (kind === 'FRANCHISE') {
    out.franchiseEntries = form.films
      .filter((f) => f.title.trim())
      .map((f) => ({
        title: f.title,
        ...(int(f.year) ? { year: int(f.year) } : {}),
        runtimeMinutes: int(f.runtimeMinutes) ?? 0,
      }));
  }
  if (draft) out.slot = int(form.slot);
  return out;
}

export const STATE_LABEL: Record<string, string> = {
  ACTIVE: 'Ativo',
  RESERVED: 'Reservado',
  SPONSORED: 'Patrocinado',
  FUNDED: 'Meta atingida',
  PAUSED: 'Pausada',
  WATCHED: 'Assistido → substituir',
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendado',
};

export function tileState(i: AdminListItem): string {
  if (i.status === 'ACTIVE' && i.reserved) return 'RESERVED';
  if (i.status === 'ACTIVE' && i.campaign?.state === 'PAUSED') return 'PAUSED';
  if (i.status === 'DRAFT' && i.publishAt) return 'SCHEDULED';
  return i.status;
}

/** Live slots per kind — one source of truth with the server (and the reviewed SQL). */
export const LIMIT: Record<Kind, number> = LIVE_LIMIT;
export const KIND_UI: Record<Kind, { many: string; one: string; nova: string; tipo: string }> = {
  MOVIE: { many: 'Filmes', one: 'filme', nova: 'Novo filme', tipo: 'filmes' },
  SERIES: { many: 'Séries', one: 'série', nova: 'Nova série', tipo: 'series' },
  FRANCHISE: { many: 'Franquias', one: 'franquia', nova: 'Nova franquia', tipo: 'franquias' },
  ANIME: { many: 'Animes', one: 'anime', nova: 'Novo anime', tipo: 'animes' },
};
