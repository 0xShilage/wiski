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
  logoId: string | null;
  slot: string;
  films: { title: string; year: string; runtimeMinutes: string }[];
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
  logoId: null,
  slot: slot ? String(slot) : '',
  films: [],
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
    logoId: f.logoId,
    slot: item.slot ? String(item.slot) : '',
    films: f.franchiseEntries.map((e) => ({
      title: e.title,
      year: e.year ? String(e.year) : '',
      runtimeMinutes: String(e.runtimeMinutes),
    })),
  };
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
  };
  if (kind !== 'FRANCHISE') {
    const r = int(form.runtimeMinutes);
    if (r) out.runtimeMinutes = r;
  }
  if (kind === 'SERIES') {
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
};

export function tileState(i: AdminListItem): string {
  if (i.status === 'ACTIVE' && i.reserved) return 'RESERVED';
  if (i.status === 'ACTIVE' && i.campaign?.state === 'PAUSED') return 'PAUSED';
  return i.status;
}

export const LIMIT: Record<Kind, number> = { MOVIE: 35, SERIES: 10, FRANCHISE: 10 };
export const KIND_UI: Record<Kind, { many: string; one: string; nova: string; tipo: string }> = {
  MOVIE: { many: 'Filmes', one: 'filme', nova: 'Novo filme', tipo: 'filmes' },
  SERIES: { many: 'Séries', one: 'série', nova: 'Nova série', tipo: 'series' },
  FRANCHISE: { many: 'Franquias', one: 'franquia', nova: 'Nova franquia', tipo: 'franquias' },
};
