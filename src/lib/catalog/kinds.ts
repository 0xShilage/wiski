export const ITEM_KINDS = ['MOVIE', 'SERIES', 'FRANCHISE'] as const;
export type ItemKindCode = (typeof ITEM_KINDS)[number];

/** Public URL segments (pt-BR). */
export const KIND_PATH: Record<ItemKindCode, 'filmes' | 'series' | 'franquias'> = {
  MOVIE: 'filmes',
  SERIES: 'series',
  FRANCHISE: 'franquias',
};
export const KIND_API: Record<ItemKindCode, 'movies' | 'series' | 'franchises'> = {
  MOVIE: 'movies',
  SERIES: 'series',
  FRANCHISE: 'franchises',
};
export const KIND_LABEL: Record<ItemKindCode, { one: string; many: string }> = {
  MOVIE: { one: 'Filme', many: 'Filmes' },
  SERIES: { one: 'Série', many: 'Séries' },
  FRANCHISE: { one: 'Franquia', many: 'Franquias' },
};

export const LIVE_STATUSES = ['ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED'] as const;
/** What the public pages list (a watched item moves to Avaliações). */
export const PUBLIC_STATUSES = ['ACTIVE', 'SPONSORED', 'FUNDED'] as const;
