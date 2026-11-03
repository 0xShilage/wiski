/**
 * Title search (2026-11-03, /assistidos): case- and accent-insensitive, every word must appear.
 * "cronicas bosque" finds "Crônicas do Bosque"; matching is done in memory on short lists.
 */
export const SEARCH_MAX = 60;

/** Lower case, accents removed (NFD + combining marks), punctuation and runs of space → one space. */
export function foldSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The query as words to look for; empty → no search. */
export function searchTerms(query: string | null | undefined): string[] {
  if (!query) return [];
  return foldSearch(query.slice(0, SEARCH_MAX)).split(' ').filter(Boolean).slice(0, 8);
}

/** True when every term appears in at least one of the texts (title, original title, …). */
export function matchesSearch(
  texts: readonly (string | null | undefined)[],
  terms: readonly string[],
): boolean {
  if (!terms.length) return true;
  const hay = texts
    .filter((t): t is string => !!t)
    .map(foldSearch)
    .join(' ');
  return terms.every((t) => hay.includes(t));
}
