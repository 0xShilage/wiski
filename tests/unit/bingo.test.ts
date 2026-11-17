/** Bingo da live (2026-11-16): the day key, the lines of a 3×3 card and the reset text. */
import { describe, expect, it } from 'vitest';
import { bingoDay, bingoResetText, completedLine, lineCells, nextBingoReset } from '@/lib/bingo';

describe('the bingo day', () => {
  it('starts at 16:00 in São Paulo', () => {
    expect(bingoDay(new Date('2026-11-16T18:59:59Z')).toISOString()).toBe(
      '2026-11-15T00:00:00.000Z',
    ); // 15:59 BRT
    expect(bingoDay(new Date('2026-11-16T19:00:00Z')).toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    ); // 16:00 BRT
    expect(bingoDay(new Date('2026-11-17T02:30:00Z')).toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    ); // 23:30 BRT
    expect(nextBingoReset(new Date('2026-11-16T12:00:00Z')).toISOString()).toBe(
      '2026-11-16T19:00:00.000Z',
    );
    expect(nextBingoReset(new Date('2026-11-16T20:00:00Z')).toISOString()).toBe(
      '2026-11-17T19:00:00.000Z',
    );
  });

  it('says today or tomorrow', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    expect(bingoResetText(nextBingoReset(now), now)).toBe('hoje às 16h');
    const evening = new Date('2026-11-16T20:00:00Z');
    expect(bingoResetText(nextBingoReset(evening), evening)).toBe('amanhã às 16h');
  });
});

describe('lines', () => {
  const card = [5, 9, 1, 14, 2, 7, 18, 3, 11];
  it('rows, columns and diagonals', () => {
    expect(completedLine(card, [5, 9, 1])).toEqual([5, 9, 1]);
    expect(completedLine(card, new Set([9, 2, 3]))).toEqual([9, 2, 3]);
    expect(completedLine(card, [1, 2, 18, 4])).toEqual([1, 2, 18]);
    expect(completedLine(card, [5, 2, 11])).toEqual([5, 2, 11]);
    expect(completedLine(card, [5, 9, 14, 7, 3])).toBeNull();
    expect(completedLine(card, [])).toBeNull();
  });
  it('the cells to light up', () => {
    expect(lineCells(card, [9, 2, 3])).toEqual([1, 4, 7]);
    expect(lineCells(card, null)).toEqual([]);
  });
});
