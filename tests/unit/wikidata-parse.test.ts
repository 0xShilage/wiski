/**
 * Reading Wikidata (2026-11-15): the editor's fill from the real JSON shapes — Portuguese labels
 * first, deprecated statements ignored, durations in any unit, the trailer (never the whole film,
 * a Portuguese one first), genres and ClassInd in the catalog's own words, a series' total
 * runtime, a franchise's films — and the quick-add picker (exact title and year first).
 */
import { describe, expect, it } from 'vitest';
import { pickCandidate } from '@/server/catalog/publishing';
import {
  ageRatingFromLabel,
  type Entity,
  fillFrom,
  genreName,
  missingOf,
  referencedIds,
  yearInText,
} from '@/server/wikidata/parse';
import { WIKI_FIXTURES } from '../support/wiki-mock';

const all = new Map(WIKI_FIXTURES.map((e) => [e.id, e as Entity]));
const get = (id: string) => all.get(id)!;
function fill(id: string, kind: Parameters<typeof fillFrom>[1]) {
  const e = get(id);
  const labels = new Map(referencedIds(e, kind).map((r) => [r, get(r)]));
  return fillFrom(e, kind, labels);
}

describe('Wikidata fill', () => {
  it('a film: every field the editor needs, in Portuguese', () => {
    const f = fill('Q900001', 'MOVIE');
    expect(f).toMatchObject({
      title: 'A Lontra Astronauta',
      originalTitle: 'The Astronaut Otter',
      year: 2019, // not the deprecated 2030
      runtimeMinutes: 112,
      ageRating: 'A12',
      genres: ['Ficção científica', 'Aventura'], // the English-only genre is left out
      director: 'Marina Duarte',
      trailer: 'ptTrailer01', // a trailer, the Portuguese one first; never the whole film
      seasonCount: null,
      franchiseEntries: [],
    });
    expect(f.cast).toHaveLength(6);
    expect(f.cast[0]).toBe('Caio Brandão');
    expect(missingOf(f, 'MOVIE')).toEqual([]);
  });

  it('a film with nothing but its name says what is missing', () => {
    const f = fill('Q900008', 'MOVIE');
    expect(f.title).toBe('O Esquilo Sem Dados');
    expect(f.originalTitle).toBeNull();
    expect(missingOf(f, 'MOVIE')).toEqual(['ano', 'duração', 'classificação', 'gêneros']);
  });

  it('a series: seasons, episodes and the whole runtime (episode × episodes)', () => {
    const f = fill('Q900003', 'SERIES');
    expect(f).toMatchObject({
      seasonCount: 3,
      episodeCount: 24,
      seasonsLabel: 'Temporadas 1–3',
      runtimeMinutes: 45 * 24,
      ageRating: 'A14',
      genres: ['Drama'],
    });
  });

  it('a franchise: its films in release order (hours read as minutes; a book left out)', () => {
    const e = get('Q900004');
    const labels = new Map(referencedIds(e, 'FRANCHISE').map((r) => [r, get(r)]));
    expect(fillFrom(e, 'FRANCHISE', labels).franchiseEntries).toEqual([
      { title: 'O Farol', year: 2010, runtimeMinutes: 120 },
      { title: 'O Farol 2: A Volta', year: 2013, runtimeMinutes: 130 },
    ]);
  });

  it('genres and ratings in the catalog’s words', () => {
    expect(genreName('filme de ficção científica')).toBe('Ficção científica');
    expect(genreName('série de televisão de drama')).toBe('Drama');
    expect(genreName('filme épico')).toBe('Épico');
    expect(genreName('filme')).toBeNull();
    expect(ageRatingFromLabel('ClassInd 16')).toBe('A16');
    expect(ageRatingFromLabel('ClassInd L')).toBe('L');
    expect(ageRatingFromLabel('Livre')).toBe('L');
    expect(ageRatingFromLabel('PG-13')).toBeNull();
    expect(yearInText('filme de 1999 dirigido por …')).toBe(1999);
    expect(yearInText('Blade Runner')).toBeNull();
  });

  it('text from Wikidata is sanitised and clipped to the catalog limits', () => {
    const e: Entity = {
      labels: { pt: { value: `<b>Título</b>\u202e ${'x'.repeat(300)}` } },
      claims: {},
    };
    const f = fillFrom(e, 'MOVIE', new Map());
    // plain text (rendered as text nodes): control and bidi characters go, markup is just text
    expect(f.title).not.toMatch(/\u202e/);
    expect(f.title.startsWith('<b>Título</b>')).toBe(true);
    expect(Array.from(f.title).length).toBeLessThanOrEqual(120);
  });
});

describe('quick add picks the right title', () => {
  const c = (id: string, title: string, year: number | null) => ({
    id,
    title,
    year,
    description: null,
  });
  const list = [
    c('Q1', 'A Lontra Astronauta 2', 2022),
    c('Q2', 'A Lontra Astronauta', 2024),
    c('Q3', 'A Lontra Astronauta', 2019),
  ];
  it('the exact title, with the year when given', () => {
    expect(pickCandidate(list, 'a lontra astronauta', 2019)?.id).toBe('Q3');
    expect(pickCandidate(list, 'A Lontra Astronauta', null)?.id).toBe('Q2');
    expect(pickCandidate(list, 'Lontra', null)?.id).toBe('Q1');
  });
  it('a year nobody matches means not found (a remake is another film)', () => {
    expect(pickCandidate(list, 'A Lontra Astronauta', 1990)).toBeNull();
    expect(
      pickCandidate([c('Q9', 'A Lontra Astronauta', null)], 'A Lontra Astronauta', 1990)?.id,
    ).toBe('Q9');
    expect(pickCandidate([], 'x', null)).toBeNull();
  });
});
