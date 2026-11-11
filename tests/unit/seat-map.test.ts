/** Campaign seat map (2026-11-11): how money becomes seats. */
import { describe, expect, it } from 'vitest';
import { SEAT_COLS, SEAT_ROWS, SEAT_WAVES, seatMap, seatOrder } from '@/lib/seat-map';

const TOTAL = SEAT_ROWS * SEAT_COLS;
const camp = (
  raised: number,
  goal = 100_000,
  remaining = goal - raised,
  state = 'OPEN' as const,
) => ({
  goalCents: goal,
  raisedCents: raised,
  remainingCents: remaining,
  state,
});
const count = (m: ReturnType<typeof seatMap>, st: string) =>
  m.seats.filter((s) => s.state === st).length;

describe('seatOrder', () => {
  it('lists every seat once, best (middle) seats first', () => {
    const order = seatOrder();
    expect(order).toHaveLength(TOTAL);
    expect(new Set(order.map((s) => `${s.row}:${s.col}`)).size).toBe(TOTAL);
    const [best] = order;
    expect([4, 5]).toContain(best!.col);
    expect([2, 3]).toContain(best!.row);
    // the corners come last
    expect(order.slice(-4).every((s) => s.col === 0 || s.col === SEAT_COLS - 1)).toBe(true);
  });
});

describe('seatMap', () => {
  it('an empty campaign is an empty room', () => {
    const m = seatMap(camp(0));
    expect([m.taken, m.held, m.percent]).toEqual([0, 0, 0]);
    expect(count(m, 'free')).toBe(TOTAL);
  });
  it('the first real centavo already takes a seat', () => {
    expect(seatMap(camp(1)).taken).toBe(1);
  });
  it('fills in proportion to the goal', () => {
    const m = seatMap(camp(50_000));
    expect(m.taken).toBe(TOTAL / 2);
    expect(m.percent).toBe(50);
    expect(count(m, 'taken')).toBe(TOTAL / 2);
  });
  it('is a full house only when the goal is met (or the campaign is funded)', () => {
    const almost = seatMap(camp(99_999));
    expect(almost.taken).toBe(TOTAL - 1);
    expect(almost.percent).toBe(99);
    expect(seatMap(camp(100_000)).taken).toBe(TOTAL);
    expect(seatMap(camp(100_000)).percent).toBe(100);
    for (const state of ['FUNDED', 'SCHEDULED', 'WATCHED'] as const)
      expect(seatMap({ ...camp(10_000), state }).taken).toBe(TOTAL);
  });
  it('pending Pix shows as reserved seats after the taken ones', () => {
    // 30% raised, 20% reserved in checkouts, 50% still open
    const m = seatMap(camp(30_000, 100_000, 50_000));
    expect(m.taken).toBe(18);
    expect(m.held).toBe(12);
    expect(count(m, 'held')).toBe(12);
    expect(seatMap(camp(30_000, 100_000, 69_999)).held).toBe(1); // a tiny hold still shows
  });
  it('"seu lugar" is one taken seat, always the same for the same viewer, never for nobody', () => {
    const a = seatMap(camp(40_000), 'viewer-a');
    const mine = a.seats.filter((s) => s.mine);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.state).toBe('taken');
    const again = seatMap(camp(40_000), 'viewer-a').seats.find((s) => s.mine)!;
    expect([again.row, again.col]).toEqual([mine[0]!.row, mine[0]!.col]);
    expect(seatMap(camp(40_000)).seats.some((s) => s.mine)).toBe(false);
    expect(seatMap(camp(0), 'viewer-a').seats.some((s) => s.mine)).toBe(false);
  });
  it('lays the seats out row by row and keeps the entrance waves in range', () => {
    const m = seatMap(camp(70_000));
    expect(m.seats.map((s) => [s.row, s.col]).slice(0, 2)).toEqual([
      [0, 0],
      [0, 1],
    ]);
    expect(m.seats.every((s) => s.wave >= 0 && s.wave < SEAT_WAVES)).toBe(true);
  });
});
