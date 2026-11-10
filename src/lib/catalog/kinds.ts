export const ITEM_KINDS = ['MOVIE', 'SERIES', 'FRANCHISE', 'ANIME'] as const;
export type ItemKindCode = (typeof ITEM_KINDS)[number];

/** Public URL segments (pt-BR). */
export const KIND_PATH: Record<ItemKindCode, 'filmes' | 'series' | 'franquias' | 'animes'> = {
  MOVIE: 'filmes',
  SERIES: 'series',
  FRANCHISE: 'franquias',
  ANIME: 'animes',
};
export const KIND_API: Record<ItemKindCode, 'movies' | 'series' | 'franchises' | 'animes'> = {
  MOVIE: 'movies',
  SERIES: 'series',
  FRANCHISE: 'franchises',
  ANIME: 'animes',
};
export const KIND_LABEL: Record<ItemKindCode, { one: string; many: string }> = {
  MOVIE: { one: 'Filme', many: 'Filmes' },
  SERIES: { one: 'Série', many: 'Séries' },
  FRANCHISE: { one: 'Franquia', many: 'Franquias' },
  ANIME: { one: 'Anime', many: 'Animes' },
};
/** Singular label in pt-BR for any kind (cards, lists). */
export const KIND_ONE: Record<ItemKindCode, string> = {
  MOVIE: 'Filme',
  SERIES: 'Série',
  FRANCHISE: 'Franquia',
  ANIME: 'Anime',
};

/**
 * Seasons and episodes (2026-11-09): a series and an anime work the same way — season fields,
 * a goal of R$ 100 per season, a few episodes per live. A franchise is films; a movie is one.
 */
export function isEpisodic(kind: string | null | undefined): kind is 'SERIES' | 'ANIME' {
  return kind === 'SERIES' || kind === 'ANIME';
}

/**
 * What holds a slot on the board and counts towards the limit (2026-11-09, "Fila"): only titles
 * open for sponsorship. A paid title (SPONSORED / FUNDED) moves to the Fila tab and frees its
 * slot; a watched one moves to Assistidos.
 */
export const LIVE_STATUSES = ['ACTIVE'] as const;
/** What the Filmes / Séries / Franquias tabs list: only what can still be sponsored. */
export const PUBLIC_STATUSES = ['ACTIVE'] as const;
/** Paid and waiting to be watched: the Fila tab. */
export const QUEUE_STATUSES = ['SPONSORED', 'FUNDED'] as const;
/** Every title on a board or in the queue ("Meta total" counts them all). */
export const BOARD_STATUSES = ['ACTIVE', 'SPONSORED', 'FUNDED'] as const;
