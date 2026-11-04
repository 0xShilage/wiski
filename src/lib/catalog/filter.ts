import { matchesSearch, SEARCH_MAX, searchTerms } from '@/lib/search';
import { percentFunded } from './pricing';
import type { PublicItem } from './types';

/**
 * Catalog filters and sort (2026-11-04): Filmes disponíveis (home) and the campaign grids of Séries
 * and Franquias. The live catalog is small (≤ 50 / 20 / 10), so the browser filters what the page
 * already has; the choice is mirrored in the address (shareable, survives a reload). Pure.
 */
export type CatalogSort =
  | 'destaque'
  | 'preco-asc'
  | 'preco-desc'
  | 'curtos'
  | 'longos'
  | 'recentes'
  | 'antigos'
  | 'az'
  | 'meta'
  | 'prazo';

export type Duration = '' | 'ate-90' | '90-120' | 'mais-120';

export type CatalogFilter = { q: string; genero: string; duracao: Duration; ordem: CatalogSort };

export const EMPTY_FILTER: CatalogFilter = { q: '', genero: '', duracao: '', ordem: 'destaque' };

export const MOVIE_SORTS: { value: CatalogSort; label: string }[] = [
  { value: 'destaque', label: 'Destaques' },
  { value: 'preco-asc', label: 'Menor preço' },
  { value: 'preco-desc', label: 'Maior preço' },
  { value: 'curtos', label: 'Mais curtos' },
  { value: 'longos', label: 'Mais longos' },
  { value: 'recentes', label: 'Mais recentes' },
  { value: 'antigos', label: 'Mais antigos' },
  { value: 'az', label: 'A–Z' },
];

export const CAMPAIGN_SORTS: { value: CatalogSort; label: string }[] = [
  { value: 'destaque', label: 'Destaques' },
  { value: 'meta', label: 'Perto da meta' },
  { value: 'prazo', label: 'Prazo acabando' },
  { value: 'recentes', label: 'Mais recentes' },
  { value: 'antigos', label: 'Mais antigos' },
  { value: 'az', label: 'A–Z' },
];

export const DURATIONS: { value: Duration; label: string }[] = [
  { value: '', label: 'Duração' },
  { value: 'ate-90', label: 'Até 1h30' },
  { value: '90-120', label: '1h30 a 2h' },
  { value: 'mais-120', label: 'Mais de 2h' },
];

const SORTS = new Set<string>([...MOVIE_SORTS, ...CAMPAIGN_SORTS].map((s) => s.value));
const DURATION_SET = new Set<string>(DURATIONS.map((d) => d.value));
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

/** Every genre on the given items, A–Z in Portuguese. */
export function genresOf(items: readonly PublicItem[]): string[] {
  return [...new Set(items.flatMap((i) => i.genres))].sort(collator.compare);
}

/** Reads `?q=&genero=&duracao=&ordem=` — anything unknown falls back to "no filter". */
export function parseFilter(
  params: Record<string, string | string[] | undefined>,
  kind: 'movies' | 'campaigns',
): CatalogFilter {
  const one = (k: string) => {
    const v = params[k];
    return typeof v === 'string' ? v : '';
  };
  const ordem = one('ordem');
  const allowed = kind === 'movies' ? MOVIE_SORTS : CAMPAIGN_SORTS;
  return {
    q: one('q').slice(0, SEARCH_MAX),
    genero: one('genero').slice(0, 60),
    duracao:
      kind === 'movies' && DURATION_SET.has(one('duracao')) ? (one('duracao') as Duration) : '',
    ordem:
      SORTS.has(ordem) && allowed.some((s) => s.value === ordem)
        ? (ordem as CatalogSort)
        : 'destaque',
  };
}

/** The query string for a filter ("" when nothing is set). */
export function filterQuery(f: CatalogFilter): string {
  const q = new URLSearchParams();
  if (f.q.trim()) q.set('q', f.q.trim());
  if (f.genero) q.set('genero', f.genero);
  if (f.duracao) q.set('duracao', f.duracao);
  if (f.ordem !== 'destaque') q.set('ordem', f.ordem);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function isFiltering(f: CatalogFilter): boolean {
  return Boolean(f.q.trim() || f.genero || f.duracao || f.ordem !== 'destaque');
}

function inDuration(minutes: number, d: Duration): boolean {
  if (d === 'ate-90') return minutes <= 90;
  if (d === '90-120') return minutes > 90 && minutes <= 120;
  if (d === 'mais-120') return minutes > 120;
  return true;
}

/** nulls last whatever the direction */
function byNumber(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
}

export function filterCatalog(
  items: readonly PublicItem[],
  f: CatalogFilter,
  now = Date.now(),
): PublicItem[] {
  const terms = searchTerms(f.q);
  const out = items.filter(
    (i) =>
      matchesSearch([i.title, i.originalTitle, i.director, ...i.cast], terms) &&
      (!f.genero || i.genres.some((g) => collator.compare(g, f.genero) === 0)) &&
      inDuration(i.runtimeMinutes, f.duracao),
  );
  const title = (a: PublicItem, b: PublicItem) => collator.compare(a.title, b.title);
  const funded = (i: PublicItem) =>
    i.campaign ? percentFunded(i.campaign.raisedCents, i.campaign.goalCents) : null;
  const deadline = (i: PublicItem) =>
    i.campaign && i.campaign.state === 'OPEN' ? Date.parse(i.campaign.deadlineAt) - now : null;
  const sorters: Record<CatalogSort, ((a: PublicItem, b: PublicItem) => number) | null> = {
    destaque: null,
    'preco-asc': (a, b) => byNumber(a.priceCents, b.priceCents, 1),
    'preco-desc': (a, b) => byNumber(a.priceCents, b.priceCents, -1),
    curtos: (a, b) => a.runtimeMinutes - b.runtimeMinutes,
    longos: (a, b) => b.runtimeMinutes - a.runtimeMinutes,
    recentes: (a, b) => byNumber(a.year, b.year, -1),
    antigos: (a, b) => byNumber(a.year, b.year, 1),
    az: null,
    meta: (a, b) => byNumber(funded(a), funded(b), -1),
    prazo: (a, b) => byNumber(deadline(a), deadline(b), 1),
  };
  const sort = sorters[f.ordem];
  if (f.ordem === 'az') return out.sort(title);
  // stable: ties keep the curated (slot) order
  return sort ? out.sort((a, b) => sort(a, b) || 0) : out;
}
