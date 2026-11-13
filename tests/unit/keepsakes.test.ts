import { describe, expect, it } from 'vitest';
import { cleanPalette, paletteFromPixels } from '@/lib/palette';
import { clippingExcerpt } from '@/lib/reviews/clipping';
import { marathonTrail } from '@/lib/trail';

const px = (...colours: [number, number, number, number][]) => {
  const out: number[] = [];
  for (const [r, g, b, n] of colours) for (let i = 0; i < n; i++) out.push(r, g, b);
  return new Uint8Array(out);
};

describe('palette', () => {
  it('most present first, near-identical colours merged, at most five', () => {
    const p = paletteFromPixels(px([200, 20, 20, 600], [20, 20, 200, 300], [240, 220, 30, 100]), 3);
    expect(p).toEqual(['#c81414', '#1414c8', '#f0dc1e']);
    expect(paletteFromPixels(px([10, 10, 10, 500], [12, 11, 10, 500]), 3)).toHaveLength(1);
    const many = px(
      ...Array.from(
        { length: 9 },
        (_, i) =>
          [i * 28, 255 - i * 28, (i * 70) % 256, 50 + i] as [number, number, number, number],
      ),
    );
    expect(paletteFromPixels(many, 3).length).toBeLessThanOrEqual(5);
    expect(paletteFromPixels(new Uint8Array(), 3)).toEqual([]);
    // four channels: alpha ignored
    expect(paletteFromPixels(new Uint8Array([255, 0, 0, 0, 255, 0, 0, 255]), 4)).toEqual([
      '#ff0000',
    ]);
  });

  it('cleanPalette keeps only #rrggbb, five at most', () => {
    expect(cleanPalette(['#abcdef', 'red', '#ABCDEF', 3, '#000000'])).toEqual([
      '#abcdef',
      '#000000',
    ]);
    expect(cleanPalette(null)).toEqual([]);
    expect(cleanPalette(Array(7).fill('#111111'))).toHaveLength(5);
  });
});

describe('marathon trail', () => {
  const base = {
    kind: 'SERIES' as const,
    seasonCount: 4,
    films: [],
    partsWatched: 2,
    partsWatchedAt: '2026-11-13T22:00:00.000Z',
    watchedAt: null,
  };
  it('stops, the next one, and the unit', () => {
    const t = marathonTrail(base)!;
    expect(t.stops.map((s) => [s.label, s.state])).toEqual([
      ['T1', 'done'],
      ['T2', 'done'],
      ['T3', 'next'],
      ['T4', 'todo'],
    ]);
    expect(t.unit.many).toBe('temporadas');
  });
  it('a franchise uses its films; a watched title is complete', () => {
    const t = marathonTrail({
      ...base,
      kind: 'FRANCHISE',
      films: [
        { position: 1, title: 'A', year: null, runtimeMinutes: 90 },
        { position: 2, title: 'B', year: null, runtimeMinutes: 90 },
        { position: 3, title: 'C', year: null, runtimeMinutes: 90 },
      ],
      partsWatched: 0,
      partsWatchedAt: null,
      watchedAt: '2026-11-01T00:00:00.000Z',
    })!;
    expect(t.complete).toBe(true);
    expect(t.stops.map((s) => s.title)).toEqual(['A', 'B', 'C']);
    expect(t.stops.every((s) => s.state === 'done')).toBe(true);
  });
  it('nothing for movies, one season, or before the first stop', () => {
    expect(marathonTrail({ ...base, kind: 'MOVIE' })).toBeNull();
    expect(marathonTrail({ ...base, seasonCount: 1 })).toBeNull();
    expect(marathonTrail({ ...base, partsWatched: 0, partsWatchedAt: null })).toBeNull();
    expect(marathonTrail({ ...base, partsWatched: 9 })!.done).toBe(4);
  });
});

describe('clipping excerpt', () => {
  it('whole words, an ellipsis, untouched when short', () => {
    expect(clippingExcerpt('  Curto   e   bom. ')).toBe('Curto e bom.');
    const long = 'palavra '.repeat(60);
    const ex = clippingExcerpt(long, 50);
    expect(ex.endsWith('palavra…')).toBe(true);
    expect([...ex].length).toBeLessThanOrEqual(51);
    expect(clippingExcerpt('Uma frase, outra frase, mais uma frase aqui', 24)).toBe(
      'Uma frase, outra frase…',
    );
  });
});
