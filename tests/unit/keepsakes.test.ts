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
  const part = (label: string, status: 'DONE' | 'SCHEDULED', episodes: number | null = 3) => ({
    label,
    status,
    at: '2026-11-13T22:00:00.000Z',
    episodes,
    franchisePosition: null,
  });
  const series = {
    kind: 'SERIES' as const,
    films: [],
    watchedAt: null,
    episodeCount: 12,
    parts: [
      part('T1 · E1–E3', 'DONE'),
      part('T1 · E4–E6', 'DONE'),
      part('T1 · E7–E9', 'SCHEDULED'),
    ],
  };
  it('a series: the parts done, the next one, the finish line', () => {
    const t = marathonTrail(series)!;
    expect(t.stops.map((s) => [s.label, s.state, s.here])).toEqual([
      ['T1 · E1–E3', 'done', false],
      ['T1 · E4–E6', 'done', true],
      ['T1 · E7–E9', 'next', false],
      ['Fim', 'todo', false],
    ]);
    expect(t.stops.at(-1)!.title).toBe('Fim da série');
    expect(t.summary).toBe('6 de 12 episódios em 2 lives.');
    // nothing booked next; no episode count; an anime's finish line
    const u = marathonTrail({
      ...series,
      kind: 'ANIME',
      episodeCount: null,
      parts: [part('T1 · E1–E3', 'DONE')],
    })!;
    expect(u.stops.map((s) => s.title)).toEqual([
      'T1 · E1–E3',
      'Próximos episódios',
      'Fim do anime',
    ]);
    expect(u.summary).toBe('1 live até agora.');
  });
  it('watched: everything filled, no pin', () => {
    const t = marathonTrail({ ...series, watchedAt: '2026-11-20T00:00:00.000Z' })!;
    expect(t.complete).toBe(true);
    expect(t.stops.map((s) => s.label)).toEqual(['T1 · E1–E3', 'T1 · E4–E6', 'Fim']);
    expect(t.stops.every((s) => s.state === 'done' && !s.here)).toBe(true);
    expect(t.summary).toBe('Maratona concluída em 2 lives.');
  });
  it('a franchise uses its films', () => {
    const films = [1, 2, 3].map((p) => ({
      position: p,
      title: `F${p}`,
      year: null,
      runtimeMinutes: 90,
    }));
    const t = marathonTrail({
      kind: 'FRANCHISE',
      films,
      watchedAt: null,
      episodeCount: null,
      parts: [{ ...part('Filme 2: F2', 'DONE', null), franchisePosition: 2 }],
    })!;
    expect(t.stops.map((s) => [s.title, s.state, s.here])).toEqual([
      ['F1', 'next', false],
      ['F2', 'done', true],
      ['F3', 'todo', false],
    ]);
    expect(t.summary).toBe('1 de 3 filmes assistidos.');
  });
  it('nothing for movies or before the first part is shown', () => {
    expect(marathonTrail({ ...series, kind: 'MOVIE' })).toBeNull();
    expect(marathonTrail({ ...series, parts: [part('T1 · E1–E3', 'SCHEDULED')] })).toBeNull();
    expect(
      marathonTrail({ ...series, parts: [], watchedAt: '2026-11-20T00:00:00.000Z' }),
    ).toBeNull();
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
