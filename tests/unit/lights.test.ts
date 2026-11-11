/** Cinema lights (2026-11-11): poster accent, split-flap board, marquee bulbs, ticket stubs. */
import { describe, expect, it } from 'vitest';
import { stubState } from '@/components/account/TicketStubs';
import { ACCENT_RE, accentFromPixels, DEFAULT_ACCENT } from '@/lib/accent';
import {
  departures,
  FLAP_COLS,
  flapChar,
  flapDay,
  flapDuration,
  fit,
  settleAt,
} from '@/lib/live/flapboard';
import { MARQUEE_H, MARQUEE_W, marqueeBulbs } from '@/lib/marquee';

const pixels = (list: [number, number, number][], repeat = 1) =>
  Uint8Array.from(list.flatMap((p) => Array.from({ length: repeat }, () => p)).flat());
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as number[];

describe('accentFromPixels', () => {
  it('a poster with no colour gets the brand lavender', () => {
    expect(
      accentFromPixels(
        pixels(
          [
            [0, 0, 0],
            [128, 128, 128],
            [255, 255, 255],
          ],
          50,
        ),
        3,
      ),
    ).toBe(DEFAULT_ACCENT);
    expect(accentFromPixels(new Uint8Array(), 3)).toBe(DEFAULT_ACCENT);
  });
  it('the most vivid hue wins over the most common colour', () => {
    // mostly near-black, a red title
    const hex = accentFromPixels(
      pixels([...Array(90).fill([10, 10, 14]), ...Array(10).fill([210, 20, 30])]),
      3,
    );
    const [r, g, b] = rgb(hex);
    expect(r).toBeGreaterThan(g! + 80);
    expect(r).toBeGreaterThan(b! + 60);
  });
  it('is always a light, readable #rrggbb (a dark navy poster still glows blue)', () => {
    const hex = accentFromPixels(pixels([[10, 20, 70]], 100), 3);
    expect(hex).toMatch(ACCENT_RE);
    const [r, g, b] = rgb(hex);
    expect(b).toBeGreaterThan(r! + 40);
    expect(Math.max(r!, g!, b!)).toBeGreaterThan(170);
  });
  it('reads RGBA too (alpha ignored)', () => {
    const rgba = Uint8Array.from(Array.from({ length: 100 }, () => [30, 200, 60, 0]).flat());
    const [r, g] = rgb(accentFromPixels(rgba, 4));
    expect(g).toBeGreaterThan(r! + 60);
  });
});

describe('split-flap board', () => {
  it('fits text to its cells: upper case, cut with a dot, padded', () => {
    expect(fit('Duna', 6)).toBe('DUNA  ');
    expect(fit('O Senhor dos Anéis', 8)).toBe('O SENHO.');
    expect([...fit('Ação', 4)]).toHaveLength(4);
  });
  it('day labels are the São Paulo weekday and day', () => {
    // 2026-11-13 01:00 UTC is still Thursday the 12th in São Paulo
    expect(flapDay('2026-11-13T01:00:00Z')).toBe('QUI 12');
  });
  it('lists unwatched titles of lives not ended, with live / next / later', () => {
    const s = (id: string, startsAt: string, o: { live?: boolean; past?: boolean } = {}) => ({
      id,
      startsAt,
      live: o.live ?? false,
      past: o.past ?? false,
      titles: [
        { title: `${id} a`, done: false, kind: 'MOVIE' },
        { title: `${id} b`, done: id === 'live', kind: 'SERIES', part: 'T1 E2' },
      ],
    });
    const rows = departures([
      s('old', '2026-11-10T23:00:00Z', { past: true }),
      s('live', '2026-11-11T23:00:00Z', { live: true }),
      s('next', '2026-11-12T23:00:00Z'),
      s('later', '2026-11-14T23:00:00Z'),
    ]);
    expect(rows.map((r) => r.tone)).toEqual(['live', 'next', 'next', 'later', 'later']);
    expect(rows[2]!.title.trim()).toBe('NEXT B T1 E2');
    expect(rows[0]!.status.trim()).toBe('AO VIVO');
    for (const r of rows) {
      expect([...r.day]).toHaveLength(FLAP_COLS.day);
      expect([...r.time]).toHaveLength(FLAP_COLS.time);
      expect([...r.title]).toHaveLength(FLAP_COLS.title);
      expect([...r.status]).toHaveLength(FLAP_COLS.status);
      expect(r.label).toMatch(/: .+ — /);
    }
    expect(departures([s('x', '2026-11-12T23:00:00Z')], 1)).toHaveLength(1);
  });
  it('cells flip through letters and settle on their own, row after row', () => {
    expect(flapChar('A', 0, 0, Number.POSITIVE_INFINITY)).toBe('A');
    expect(flapChar(' ', 3, 10, 0)).toBe(' ');
    expect(flapChar('Z', 2, 5, settleAt(2, 5))).toBe('Z');
    expect(flapChar('Z', 2, 5, 10)).toMatch(/^[A-Z0-9]$/);
    // the same frame twice shows the same letter (render-safe)
    expect(flapChar('Z', 2, 5, 140)).toBe(flapChar('Z', 2, 5, 150));
    expect(settleAt(1, 0)).toBeGreaterThan(settleAt(0, 0));
    expect(flapDuration(8)).toBeGreaterThan(settleAt(7, 36));
  });
});

describe('marquee bulbs', () => {
  const bulbs = marqueeBulbs();
  it('a chase without a seam: a multiple of 3, phases 0, 1, 2 in turn', () => {
    expect(bulbs.length % 3).toBe(0);
    bulbs.forEach((b, i) => expect(b.phase).toBe(i % 3));
  });
  it('every bulb sits in the 3% border around the player, all four sides used', () => {
    for (const b of bulbs) {
      const inX = b.x <= MARQUEE_W * 0.03 || b.x >= MARQUEE_W * 0.97;
      const inY = b.y <= MARQUEE_H * 0.03 || b.y >= MARQUEE_H * 0.97;
      expect(inX || inY).toBe(true);
    }
    expect(new Set(bulbs.map((b) => `${b.x},${b.y}`)).size).toBe(bulbs.length);
    expect(bulbs.some((b) => b.x > MARQUEE_W / 2 && b.y < 30)).toBe(true);
    expect(bulbs.some((b) => b.y > MARQUEE_H / 2 && b.x > MARQUEE_W - 30)).toBe(true);
  });
});

describe('ticket stubs', () => {
  it('a ticket is valid only once paid and until refunded', () => {
    expect(stubState('PAID')).toBe('valid');
    expect(stubState('SCHEDULED')).toBe('valid');
    expect(stubState('WATCHING')).toBe('valid');
    expect(stubState('COMPLETED')).toBe('used');
    expect(stubState('PENDING_PAYMENT')).toBe('pending');
    expect(stubState('NEEDS_ATTENTION')).toBe('pending');
    for (const s of ['EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'] as const)
      expect(stubState(s)).toBe('void');
  });
});
