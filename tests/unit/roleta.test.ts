/**
 * Roleta (2026-11-04): the exact odds of the draw, the wheel's slices and the 17:00 BRT periods.
 * Pure functions, no database.
 */
import { describe, expect, it } from 'vitest';
import {
  NADA_SLOTS,
  nadaPercent,
  nextResetText,
  nextRoletaReset,
  oddsText,
  prizeForDraw,
  ROLETA_DRAW_SPACE,
  ROLETA_SLICES,
  roletaPeriod,
  slotForPrize,
  type RoletaPrize,
} from '@/lib/roleta';

describe('the draw', () => {
  it('every draw value maps to a prize with exactly the asked odds', () => {
    const count: Record<RoletaPrize, number> = {
      NADA: 0,
      FILME: 0,
      DOIS_FILMES: 0,
      VIP_TWITCH: 0,
      CUPOM_30: 0,
    };
    for (let v = 0; v < ROLETA_DRAW_SPACE; v++) count[prizeForDraw(v)]++;
    expect(count.FILME / ROLETA_DRAW_SPACE).toBe(1 / 500);
    expect(count.VIP_TWITCH / ROLETA_DRAW_SPACE).toBe(1 / 2500);
    expect(count.DOIS_FILMES / ROLETA_DRAW_SPACE).toBe(1 / 1000);
    expect(count.CUPOM_30 / ROLETA_DRAW_SPACE).toBe(1 / 150);
    expect(count.NADA).toBe(ROLETA_DRAW_SPACE - 30 - 6 - 15 - 100);
    expect(nadaPercent()).toBeCloseTo((100 * 14_849) / 15_000, 10);
  });

  it('refuses values outside the draw space', () => {
    expect(() => prizeForDraw(-1)).toThrow();
    expect(() => prizeForDraw(ROLETA_DRAW_SPACE)).toThrow();
    expect(() => prizeForDraw(1.5)).toThrow();
  });

  it('the odds read in pt-BR', () => {
    expect(oddsText(150)).toBe('1 em 150 (0,67%)');
    expect(oddsText(2500)).toBe('1 em 2.500 (0,04%)');
  });
});

describe('the wheel', () => {
  it('nine slices: four prizes and five "Nada"; each prize lands on its own slice', () => {
    expect(ROLETA_SLICES).toHaveLength(9);
    expect(NADA_SLOTS).toEqual([1, 3, 5, 7, 8]);
    for (const p of ['FILME', 'DOIS_FILMES', 'VIP_TWITCH', 'CUPOM_30'] as const) {
      expect(ROLETA_SLICES[slotForPrize(p)]).toBe(p);
    }
    expect([0, 1, 2, 3, 4, 7].map((k) => slotForPrize('NADA', k))).toEqual([1, 3, 5, 7, 8, 5]);
  });
});

describe('periods (5 spins renewed at 17:00 BRT)', () => {
  const at = (iso: string) => new Date(iso);
  it('a period starts at 17:00 BRT (20:00 UTC) and is named by its start day', () => {
    // 16:59 BRT on Nov 4 still belongs to the period that started Nov 3 at 17:00
    expect(roletaPeriod(at('2026-11-04T19:59:59.999Z')).toISOString()).toBe(
      '2026-11-03T00:00:00.000Z',
    );
    expect(roletaPeriod(at('2026-11-04T20:00:00.000Z')).toISOString()).toBe(
      '2026-11-04T00:00:00.000Z',
    );
    // 02:00 BRT on Nov 5 (05:00 UTC) is still Nov 4's period
    expect(roletaPeriod(at('2026-11-05T05:00:00Z')).toISOString()).toBe('2026-11-04T00:00:00.000Z');
  });

  it('the next renewal is the following 17:00 BRT', () => {
    expect(nextRoletaReset(at('2026-11-04T19:00:00Z')).toISOString()).toBe(
      '2026-11-04T20:00:00.000Z',
    );
    expect(nextRoletaReset(at('2026-11-04T20:00:00Z')).toISOString()).toBe(
      '2026-11-05T20:00:00.000Z',
    );
    expect(nextRoletaReset(at('2026-12-31T23:00:00Z')).toISOString()).toBe(
      '2027-01-01T20:00:00.000Z',
    );
  });

  it('"hoje" / "amanhã" in BRT', () => {
    expect(nextResetText('2026-11-04T20:00:00Z', at('2026-11-04T12:00:00Z'))).toBe('hoje às 17h');
    expect(nextResetText('2026-11-05T20:00:00Z', at('2026-11-04T21:00:00Z'))).toBe('amanhã às 17h');
    // 01:00 BRT on Nov 5 → the renewal at 17:00 the same day is "hoje"
    expect(nextResetText('2026-11-05T20:00:00Z', at('2026-11-05T04:00:00Z'))).toBe('hoje às 17h');
  });
});
