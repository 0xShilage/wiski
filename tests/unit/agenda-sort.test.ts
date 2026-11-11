/** The Fila sort control (2026-11-10): alphabetical A→Z / Z→A, ignoring case and accents. */
import { describe, expect, it } from 'vitest';
import { sortQueue } from '@/lib/admin/agenda-sort';
import type { AgendaEntry } from '@/lib/admin/types';

/** A minimal queue entry: only the fields the sort reads matter. */
function entry(title: string, kind: AgendaEntry['kind'] = 'ORDER'): AgendaEntry {
  const base = {
    kind,
    id: title,
    version: 0,
    status: 'PAID',
    runtimeMinutes: 90,
    sponsor: null,
    message: null,
    tier: null,
    since: '2026-11-10T00:00:00.000Z',
    sessionId: null,
    publicCode: null,
    segment: null,
  } as const;
  return { ...base, item: { id: title, kind: 'MOVIE', slug: title, title } };
}

const titles = (list: AgendaEntry[]) => list.map((e) => e.item?.title ?? '');

describe('sortQueue', () => {
  it('keeps the server order and the same array reference for "fila"', () => {
    const q = [entry('Zona Zero'), entry('Aftersun'), entry('Dogville')];
    const out = sortQueue(q, 'fila');
    expect(out).toBe(q);
    expect(titles(out)).toEqual(['Zona Zero', 'Aftersun', 'Dogville']);
  });

  it('sorts A → Z by title and never mutates the input', () => {
    const q = [entry('Zona Zero'), entry('Aftersun'), entry('Dogville')];
    expect(titles(sortQueue(q, 'az'))).toEqual(['Aftersun', 'Dogville', 'Zona Zero']);
    expect(titles(q)).toEqual(['Zona Zero', 'Aftersun', 'Dogville']); // input untouched
  });

  it('sorts Z → A by title', () => {
    const q = [entry('Aftersun'), entry('Zona Zero'), entry('Dogville')];
    expect(titles(sortQueue(q, 'za'))).toEqual(['Zona Zero', 'Dogville', 'Aftersun']);
  });

  it('ignores case and accents (pt-BR)', () => {
    const q = [entry('Ótimo'), entry('amor'), entry('Ámbar'), entry('Avô')];
    // base sensitivity: á == a, so Ámbar < amor < Avô < Ótimo
    expect(titles(sortQueue(q, 'az'))).toEqual(['Ámbar', 'amor', 'Avô', 'Ótimo']);
  });

  it('orders a funded campaign by its title like any other entry', () => {
    const q = [entry('Zona Zero'), entry('Coleção Moldura', 'CAMPAIGN'), entry('Aftersun')];
    expect(titles(sortQueue(q, 'az'))).toEqual(['Aftersun', 'Coleção Moldura', 'Zona Zero']);
  });

  it('returns an empty array unchanged', () => {
    expect(sortQueue([], 'az')).toEqual([]);
  });
});
