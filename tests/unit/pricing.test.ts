import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { moviePriceCents } from '@/lib/catalog/pricing';
import {
  canonicalJson,
  DEFAULT_PRICING_CONFIG,
  type PricingConfig,
  pricingConfigSchema,
} from '@/lib/pricing/config';
import {
  formatBps,
  linesTotal,
  mulBps,
  type Perk,
  PriceError,
  type PriceInput,
  priceMovie,
  type VoucherTerms,
} from '@/lib/pricing/engine';

/** 04 §9 / §11 — the price engine. */
const C = DEFAULT_PRICING_CONFIG;
const input = (over: Partial<PriceInput> = {}): PriceInput => ({
  runtimeMinutes: 120,
  queueJumpTierId: null,
  voucher: null,
  perk: null,
  ...over,
});
const voucher = (over: Partial<VoucherTerms>): VoucherTerms => ({
  code: 'CUPOM-TESTE',
  kind: 'PERCENT',
  percentBps: null,
  amountCents: null,
  maxDiscountCents: null,
  minSubtotalCents: null,
  ...over,
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof PriceError ? e.code : `other: ${String(e)}`;
  }
  return 'no error';
};

describe('worked examples (04 §9, active config)', () => {
  it.each([
    ['E1 movie 128 min', input({ runtimeMinutes: 128 }), 2000],
    ['E2 exactly 130 min (inclusive band edge)', input({ runtimeMinutes: 130 }), 2000],
    ['E3 131 min', input({ runtimeMinutes: 131 }), 2100],
    [
      'E4 172 min, VIP, Prioridade',
      input({ runtimeMinutes: 172, perk: 'VIP', queueJumpTierId: 'prioridade' }),
      10_540,
    ],
    [
      'E7 voucher 12,5 % on 131 min (half-up)',
      input({ runtimeMinutes: 131, voucher: voucher({ percentBps: 1250 }) }),
      1837,
    ],
    [
      'E8 FIXED R$ 50 on a R$ 20 movie → clamped to the R$ 5 minimum',
      input({ voucher: voucher({ kind: 'FIXED', amountCents: 5000 }) }),
      500,
    ],
    [
      'E10 moderator 10 % beats a 5 % voucher',
      input({ perk: 'MODERATOR', voucher: voucher({ percentBps: 500 }) }),
      1800,
    ],
    ['Topo da fila on a R$ 20 movie', input({ queueJumpTierId: 'topo' }), 5200],
    [
      'Prioridade on a 150 min movie',
      input({ runtimeMinutes: 150, queueJumpTierId: 'prioridade' }),
      7200,
    ],
    [
      'Topo da fila on a 150 min movie',
      input({ runtimeMinutes: 150, queueJumpTierId: 'topo' }),
      10_400,
    ],
  ])('%s', (_name, i, total) => {
    const b = priceMovie(C, i);
    expect(b.totalCents).toBe(total);
    expect(linesTotal(b.lines)).toBe(total);
    expect(b.lines.at(-1)).toEqual({ kind: 'total', label: 'Total', cents: total });
  });

  it('E4 breakdown lines in canonical order', () => {
    const b = priceMovie(
      C,
      input({ runtimeMinutes: 172, perk: 'VIP', queueJumpTierId: 'prioridade' }),
    );
    expect(b.lines).toEqual([
      { kind: 'info', label: 'Duração: 2 h 52 min', cents: null },
      { kind: 'base', label: 'Filme', cents: 2000 },
      { kind: 'extra', label: 'Minutos adicionais (42 × R$ 1,00)', cents: 4200 },
      { kind: 'subtotal', label: 'Subtotal', cents: 6200 },
      { kind: 'discount', label: 'Desconto VIP (10 %)', cents: -620 },
      { kind: 'queueJump', label: 'Prioridade (+80 %)', cents: 4960 },
      { kind: 'total', label: 'Total', cents: 10_540 },
    ]);
    expect(b.discountSource).toBe('PERK');
    expect(b.tier).toEqual({
      id: 'prioridade',
      label: 'Prioridade',
      bps: 8000,
      placement: 'AHEAD_OF_REGULAR',
    });
  });

  it('E10: the voucher is not used (not consumed) and the page says why', () => {
    const b = priceMovie(C, input({ perk: 'MODERATOR', voucher: voucher({ percentBps: 500 }) }));
    expect(b.voucherApplied).toBe(false);
    expect(b.lines.map((l) => l.label)).toContain(
      'Cupom CUPOM-TESTE não usado: seu desconto atual já é maior ou igual',
    );
  });

  it('perk vs voucher tie → perk wins, voucher kept', () => {
    const b = priceMovie(C, input({ perk: 'VIP', voucher: voucher({ percentBps: 1000 }) }));
    expect(b.discountSource).toBe('PERK');
    expect(b.voucherApplied).toBe(false);
    expect(b.discountCents).toBe(200);
  });

  it('a voucher bigger than the perk is applied', () => {
    const b = priceMovie(C, input({ perk: 'VIP', voucher: voucher({ percentBps: 2000 }) }));
    expect(b.discountSource).toBe('VOUCHER');
    expect(b.voucherApplied).toBe(true);
    expect(b.lines).toContainEqual({ kind: 'discount', label: 'Cupom CUPOM-TESTE', cents: -400 });
  });

  it('PERCENT voucher respects maxDiscountCents', () => {
    const b = priceMovie(
      C,
      input({
        runtimeMinutes: 300,
        voucher: voucher({ percentBps: 5000, maxDiscountCents: 1000 }),
      }),
    );
    expect(b.discountCents).toBe(1000);
  });

  it('the queue-jump surcharge is computed on the pre-discount subtotal and never discounted', () => {
    const plain = priceMovie(C, input({ queueJumpTierId: 'prioridade' }));
    const vip = priceMovie(C, input({ queueJumpTierId: 'prioridade', perk: 'VIP' }));
    expect(vip.queueJumpCents).toBe(plain.queueJumpCents);
    expect(plain.totalCents - vip.totalCents).toBe(200);
  });
});

describe('band edges and limits', () => {
  it.each([
    [1, 2000],
    [129, 2000],
    [130, 2000],
    [131, 2100],
    [359, 24_900],
    [360, 25_000],
  ])('%i min → %i', (min, cents) => {
    expect(priceMovie(C, input({ runtimeMinutes: min })).totalCents).toBe(cents);
  });

  it.each([0, -1, 361, 1.5, Number.NaN])('runtime %s → RUNTIME_OUT_OF_RANGE', (min) => {
    expect(code(() => priceMovie(C, input({ runtimeMinutes: min })))).toBe('RUNTIME_OUT_OF_RANGE');
  });

  it('matches the dashboard/public price for every runtime of the default rule set', () => {
    for (let m = 1; m <= 360; m++) {
      expect(priceMovie(C, input({ runtimeMinutes: m })).totalCents).toBe(moviePriceCents(m));
    }
  });

  it('general band logic (synthetic multi-band config)', () => {
    const multi: PricingConfig = {
      ...C,
      movie: {
        ...C.movie,
        bands: [
          { upToMinutes: 90, baseCents: 1500 },
          { upToMinutes: 130, baseCents: 2000 },
          { upToMinutes: 180, baseCents: 3000 },
        ],
        perMinuteOverCents: 50,
      },
    };
    const t = (m: number) => priceMovie(multi, input({ runtimeMinutes: m })).totalCents;
    expect([t(90), t(91), t(130), t(131), t(180), t(181), t(200)]).toEqual([
      1500, 2000, 2000, 3000, 3000, 3050, 4000,
    ]);
  });

  it('above the maximum order → TOTAL_ABOVE_LIMIT; queue jump errors', () => {
    const tight: PricingConfig = { ...C, maxTotalCents: 5000 };
    expect(
      code(() => priceMovie(tight, input({ queueJumpTierId: 'topo', runtimeMinutes: 200 }))),
    ).toBe('TOTAL_ABOVE_LIMIT');
    expect(code(() => priceMovie(C, input({ queueJumpTierId: 'vip-pass' })))).toBe(
      'QUEUE_JUMP_TIER_INVALID',
    );
    const off: PricingConfig = { ...C, queueJump: { ...C.queueJump, enabled: false } };
    expect(code(() => priceMovie(off, input({ queueJumpTierId: 'prioridade' })))).toBe(
      'QUEUE_JUMP_DISABLED',
    );
    expect(
      code(() =>
        priceMovie(C, input({ voucher: voucher({ percentBps: 1000, minSubtotalCents: 3000 }) })),
      ),
    ).toBe('VOUCHER_MIN_SUBTOTAL');
  });
});

describe('rounding (mulBps, half up)', () => {
  it.each([
    [2100, 1250, 263], // 262.5 → 263
    [1999, 1, 0], // 0.1999
    [5000, 1, 1], // 0.5 → 1
    [4999, 1, 0], // 0.4999
    [5001, 1, 1], // 0.5001
    [6200, 8000, 4960],
    [6200, 16_000, 9920],
    [12_345, 0, 0],
    [12_345, 10_000, 12_345],
    [12_345, 9999, 12_344], // 12343.7655 → 12344
  ])('mulBps(%i, %i) = %i', (a, bps, out) => {
    expect(mulBps(a, bps)).toBe(out);
  });

  it('rejects non-integers and overflow', () => {
    expect(() => mulBps(1.5, 100)).toThrow(RangeError);
    expect(() => mulBps(Number.MAX_SAFE_INTEGER, 10_000)).toThrow(RangeError);
  });

  it('formats percentages the pt-BR way', () => {
    expect([formatBps(1000), formatBps(1250), formatBps(8000), formatBps(16_000)]).toEqual([
      '10 %',
      '12,5 %',
      '80 %',
      '160 %',
    ]);
  });
});

describe('properties (fast-check)', () => {
  const perkArb = fc.constantFrom<Perk>(null, 'VIP', 'MODERATOR');
  const tierArb = fc.constantFrom<string | null>(null, 'prioridade', 'topo');
  const voucherArb = fc.option(
    fc.oneof(
      fc.record({
        kind: fc.constant('PERCENT' as const),
        percentBps: fc.integer({ min: 1, max: 10_000 }),
        maxDiscountCents: fc.option(fc.integer({ min: 1, max: 50_000 }), { nil: null }),
      }),
      fc.record({
        kind: fc.constant('FIXED' as const),
        amountCents: fc.integer({ min: 1, max: 100_000 }),
      }),
    ),
    { nil: null },
  );

  it('total = Σ lines; integers only; within [min, max]; discount ≤ subtotal − min', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 360 }),
        perkArb,
        tierArb,
        voucherArb,
        (runtimeMinutes, perk, queueJumpTierId, v) => {
          const b = priceMovie(C, {
            runtimeMinutes,
            perk,
            queueJumpTierId,
            voucher: v ? voucher(v) : null,
          });
          const parts = b.lines.filter((l) => l.kind === 'base' || l.kind === 'extra');
          const s = parts.reduce((x, l) => x + l.cents!, 0);
          expect(s).toBe(b.subtotalCents);
          expect(b.totalCents).toBe(b.subtotalCents - b.discountCents + b.queueJumpCents);
          expect(linesTotal(b.lines)).toBe(b.totalCents);
          for (const n of [b.subtotalCents, b.discountCents, b.queueJumpCents, b.totalCents]) {
            expect(Number.isSafeInteger(n) && n >= 0).toBe(true);
          }
          expect(b.totalCents).toBeGreaterThanOrEqual(C.minTotalCents);
          expect(b.totalCents).toBeLessThanOrEqual(C.maxTotalCents);
          expect(b.discountCents).toBeLessThanOrEqual(b.subtotalCents - C.minTotalCents);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('monotonic in runtime; Q independent of the discount', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 359 }), perkArb, tierArb, (m, perk, tier) => {
        const a = priceMovie(C, input({ runtimeMinutes: m, perk, queueJumpTierId: tier }));
        const b = priceMovie(C, input({ runtimeMinutes: m + 1, perk, queueJumpTierId: tier }));
        expect(b.totalCents).toBeGreaterThanOrEqual(a.totalCents);
        const noPerk = priceMovie(C, input({ runtimeMinutes: m, queueJumpTierId: tier }));
        expect(a.queueJumpCents).toBe(noPerk.queueJumpCents);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('PricingConfig v1', () => {
  it('the default config validates', () => {
    expect(pricingConfigSchema.parse(C)).toEqual(C);
  });

  it.each([
    ['unknown key', { ...C, addOns: [] }],
    ['min > max', { ...C, minTotalCents: 300_000 }],
    [
      'non-increasing bands',
      {
        ...C,
        movie: {
          ...C.movie,
          bands: [
            { upToMinutes: 130, baseCents: 1 },
            { upToMinutes: 130, baseCents: 2 },
          ],
        },
      },
    ],
    [
      'tier below 80 %',
      {
        ...C,
        queueJump: {
          ...C.queueJump,
          tiers: [{ id: 'x1', label: 'x', bps: 7999, placement: 'TOP' }],
        },
      },
    ],
    [
      'duplicate tier',
      { ...C, queueJump: { ...C.queueJump, tiers: [C.queueJump.tiers[0], C.queueJump.tiers[0]] } },
    ],
    ['float cents', { ...C, minTotalCents: 500.5 }],
  ])('rejects: %s', (_n, bad) => {
    expect(pricingConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: 'x' }] })).toBe(
      '{"a":[2,{"c":"x","d":null}],"b":1}',
    );
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
