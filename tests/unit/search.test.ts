/** Title search (2026-11-03, /assistidos): case- and accent-insensitive, every word must appear. */
import { describe, expect, it } from 'vitest';
import { foldSearch, matchesSearch, SEARCH_MAX, searchTerms } from '@/lib/search';

describe('title search', () => {
  it('folds case, accents and punctuation', () => {
    expect(foldSearch('Crônicas do Bosque: Ação!')).toBe('cronicas do bosque acao');
    expect(foldSearch('  O   Pequeno—Príncipe ')).toBe('o pequeno principe');
  });

  it('splits the query into words; empty or blank → no search', () => {
    expect(searchTerms('  Crônicas   BOSQUE ')).toEqual(['cronicas', 'bosque']);
    expect(searchTerms('')).toEqual([]);
    expect(searchTerms('   ')).toEqual([]);
    expect(searchTerms(null)).toEqual([]);
    expect(searchTerms('—!?')).toEqual([]);
  });

  it('caps the query length and the number of words', () => {
    expect(searchTerms('a'.repeat(200))[0]!.length).toBe(SEARCH_MAX);
    expect(searchTerms('a b c d e f g h i j k')).toHaveLength(8);
  });

  it('every word must appear, in the title or the original title', () => {
    const t = ['Crônicas do Bosque', 'Forest Chronicles'];
    expect(matchesSearch(t, searchTerms('cronicas'))).toBe(true);
    expect(matchesSearch(t, searchTerms('bosque CRÔN'))).toBe(true);
    expect(matchesSearch(t, searchTerms('forest'))).toBe(true);
    expect(matchesSearch(t, searchTerms('cronicas mar'))).toBe(false);
    expect(matchesSearch([null, undefined], searchTerms('x'))).toBe(false);
    expect(matchesSearch(t, [])).toBe(true);
  });
});
