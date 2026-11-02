/**
 * Price engine (04 §4, §9, §11): worked examples as table tests, band edges, rounding, perks,
 * every error code, and property tests. Series/anime packages (E5, E6) and YouTube (E11) left the
 * product with the redesign (11 §10); the general engine paths they covered are tested with
 * synthetic configs instead.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  moviePriceCents,
  MOVIE_BASE_CENTS,
  MOVIE_BASE_UP_TO_MIN,
  MOVIE_MAX_RUNTIME,
  MOVIE_PER_EXTRA_MIN_CENTS,
  MIN_CONTRIBUTION_CENTS,
} from '@/lib/catalog/pricing';
import {
  canonicalJson,
  configHash,
  type PricingConfig,
  pricingConfigSchema,
  RULESET_REV3,
} from '@/server/pricing/config';
import {
  checkContribution,
  formatBps,
  mulBps,
  type PriceContext,
  PriceError,
  priceMovie,
  type VoucherContext,
} from '@/server/pricing/engine';

const NOW = new Date('2026-10-30T15:00:00Z');
const cfg = RULESET_REV3;
const free = { soldOut: false, buyerLimitReached: false };
const ctx = (over: Partial<PriceContext> = {}): PriceContext => ({
  perk: 'NONE',
  voucher: null,
  queueJump: free,
  now: NOW,
  ...over,
});
const voucher = (over: Partial<VoucherContext> = {}): VoucherContext => ({
  code: 'CUPOM-TESTE',
  kind: 'PERCENT',
  percentBps: 1000,
  amountCents: null,
  maxDiscountCents: null,
  minSubtotalCents: null,
  startsAt: null,
  endsAt: null,
  active: true,
  maxRedemptions: null,
  redemptionCount: 0,
  maxPerUser: 1,
  buyerRedemptions: 0,
  ...over,
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof PriceError) return e.code;
    throw e;
  }
  return 'OK';
};
const sumLines = (b: ReturnType<typeof priceMovie>) =>
  b.lines
    .filter((l) => !['runtime', 'subtotal', 'total'].includes(l.key))
    .reduce((s, l) => s + (l.cents ?? 0), 0);

describe('rule set rev 3', () => {
  it('is a valid PricingConfig and mirrors the public price constants', () => {
    expect(pricingConfigSchema.parse(cfg)).toEqual(cfg);
    const m = cfg.kinds.MOVIE;
    expect(m.pricing.bands).toEqual([
      { upToMinutes: MOVIE_BASE_UP_TO_MIN, baseCents: MOVIE_BASE_CENTS },
    ]);
    expect(m.pricing.perMinuteOverCents).toBe(MOVIE_PER_EXTRA_MIN_CENTS);
    expect(m.maxRuntimeMinutes).toBe(MOVIE_MAX_RUNTIME);
    expect(cfg.contributions.minCents).toBe(MIN_CONTRIBUTION_CENTS);
    for (const R of [1, 90, 130, 131, 172, 360]) {
      expect(priceMovie(cfg, { runtimeMinutes: R }, ctx()).totalCents).toBe(moviePriceCents(R));
    }
  });
  it('canonical JSON sorts keys recursively and hashes stably', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverseKeys)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reverseKeys(x)]),
            )
          : v;
    const shuffled = reverseKeys(cfg);
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(cfg));
    expect(Buffer.from(configHash(shuffled))).toEqual(Buffer.from(configHash(cfg)));
  });
  it('rejects malformed configs (fail closed)', () => {
    const bad = (patch: (c: PricingConfig) => void) => {
      const c = structuredClone(cfg) as PricingConfig;
      patch(c);
      return pricingConfigSchema.safeParse(c).success;
    };
    expect(bad(() => {})).toBe(true);
    expect(bad((c) => void ((c as { extra?: number }).extra = 1))).toBe(false);
    expect(bad((c) => void (c.queueJump.tiers[0]!.bps = 7999))).toBe(false);
    expect(bad((c) => void (c.queueJump.tiers[1]!.id = 'prioridade'))).toBe(false);
    expect(
      bad((c) => void c.kinds.MOVIE.pricing.bands.push({ upToMinutes: 100, baseCents: 1 })),
    ).toBe(false);
    expect(bad((c) => void (c.minTotalCents = 300_000))).toBe(false);
    expect(bad((c) => void (c.contributions.minCents = 550))).toBe(false);
  });
});

describe('worked examples (04 §9)', () => {
  const total = (runtime: number, over: Partial<PriceContext> = {}, tier: string | null = null) =>
    priceMovie(cfg, { runtimeMinutes: runtime, queueJumpTierId: tier }, ctx(over)).totalCents;

  it('E1 movie 128 min → R$ 20,00', () => expect(total(128)).toBe(2000));
  it('E2 exactly 130 min (inclusive band edge) → R$ 20,00', () => expect(total(130)).toBe(2000));
  it('E3 131 min → R$ 21,00', () => expect(total(131)).toBe(2100));
  it('E4 172 min, VIP, Prioridade → R$ 105,40', () => {
    const b = priceMovie(
      cfg,
      { runtimeMinutes: 172, queueJumpTierId: 'prioridade' },
      ctx({ perk: 'VIP' }),
    );
    expect(b.lines.map((l) => [l.key, l.cents])).toEqual([
      ['runtime', null],
      ['base', 2000],
      ['extra', 4200],
      ['subtotal', 6200],
      ['discount', -620],
      ['queue-jump', 4960],
      ['total', 10540],
    ]);
    expect(b.lines.find((l) => l.key === 'extra')!.label).toBe('Minutos adicionais (42 × R$ 1,00)');
    expect(b.lines.find((l) => l.key === 'queue-jump')!.label).toBe('Prioridade (+80 %)');
    expect(b.lines[0]!.label).toBe('Duração: 2 h 52 min');
    expect(b.discountSource).toBe('VIP');
  });
  it('E5′ Topo da fila on a R$ 20,00 movie → R$ 52,00 (grid, 04 §3)', () =>
    expect(total(120, {}, 'topo')).toBe(5200));
  it('E5″ grid: 150 min → 40 / 72 / 104', () => {
    expect(total(150)).toBe(4000);
    expect(total(150, {}, 'prioridade')).toBe(7200);
    expect(total(150, {}, 'topo')).toBe(10400);
  });
  it('E7 rounding: 12,5 % voucher on 131 min → R$ 18,37 (262,5 → 263)', () =>
    expect(total(131, { voucher: voucher({ percentBps: 1250 }) })).toBe(1837));
  it('E8 FIXED R$ 50 voucher on R$ 20 movie → clamped to the R$ 5,00 minimum', () => {
    const b = priceMovie(
      cfg,
      { runtimeMinutes: 100 },
      ctx({ voucher: voucher({ kind: 'FIXED', percentBps: null, amountCents: 5000 }) }),
    );
    expect(b.discountCents).toBe(1500);
    expect(b.totalCents).toBe(500);
    expect(b.voucherApplied).toBe(true);
  });
  it('E9 queue jump sold out / buyer limit', () => {
    expect(
      code(() => total(100, { queueJump: { soldOut: true, buyerLimitReached: false } }, 'topo')),
    ).toBe('QUEUE_JUMP_SOLD_OUT');
    expect(
      code(() => total(100, { queueJump: { soldOut: true, buyerLimitReached: true } }, 'topo')),
    ).toBe('QUEUE_JUMP_BUYER_LIMIT');
  });
  it('E10 moderator + 5 % voucher → perk wins, voucher not consumed → R$ 18,00', () => {
    const b = priceMovie(
      cfg,
      { runtimeMinutes: 100 },
      ctx({ perk: 'MODERATOR', voucher: voucher({ percentBps: 500 }) }),
    );
    expect(b.totalCents).toBe(1800);
    expect(b.discountSource).toBe('MODERATOR');
    expect(b.voucherApplied).toBe(false);
  });
  it('E10′ perk vs voucher tie → perk (voucher not consumed)', () => {
    const b = priceMovie(
      cfg,
      { runtimeMinutes: 100 },
      ctx({ perk: 'VIP', voucher: voucher({ percentBps: 1000 }) }),
    );
    expect(b.discountSource).toBe('VIP');
    expect(b.voucherApplied).toBe(false);
  });
  it('E11′ disabled kind → KIND_DISABLED', () => {
    const c = structuredClone(cfg);
    c.kinds.MOVIE.enabled = false;
    expect(code(() => priceMovie(c, { runtimeMinutes: 100 }, ctx()))).toBe('KIND_DISABLED');
  });
  it('the surcharge is never discounted (moderator + Topo)', () => {
    const b = priceMovie(
      cfg,
      { runtimeMinutes: 100, queueJumpTierId: 'topo' },
      ctx({ perk: 'MODERATOR' }),
    );
    expect(b.queueJumpCents).toBe(3200); // 160 % of the pre-discount 2000
    expect(b.totalCents).toBe(2000 - 200 + 3200);
  });
});

describe('band edges and runtime limits', () => {
  it.each([
    [129, 2000],
    [130, 2000],
    [131, 2100],
    [1, 2000],
    [360, 2000 + 230 * 100],
  ])('%i min → %i', (R, want) =>
    expect(priceMovie(cfg, { runtimeMinutes: R }, ctx()).totalCents).toBe(want),
  );
  it.each([0, 361, -1, 1.5, Number.NaN])('runtime %s → RUNTIME_OUT_OF_RANGE', (R) =>
    expect(code(() => priceMovie(cfg, { runtimeMinutes: R }, ctx()))).toBe('RUNTIME_OUT_OF_RANGE'),
  );
  it('missing runtime → RUNTIME_UNKNOWN', () =>
    expect(code(() => priceMovie(cfg, { runtimeMinutes: null }, ctx()))).toBe('RUNTIME_UNKNOWN'));
  it('multi-band synthetic config: first band that fits, extra minutes above the last', () => {
    const c = structuredClone(cfg);
    c.kinds.MOVIE.pricing.bands = [
      { upToMinutes: 90, baseCents: 1500 },
      { upToMinutes: 130, baseCents: 2000 },
      { upToMinutes: 180, baseCents: 3000 },
    ];
    c.kinds.MOVIE.pricing.perMinuteOverCents = 50;
    const t = (R: number) => priceMovie(c, { runtimeMinutes: R }, ctx()).totalCents;
    expect([t(89), t(90), t(91), t(130), t(131), t(180), t(181), t(200)]).toEqual([
      1500, 1500, 2000, 2000, 3000, 3000, 3050, 4000,
    ]);
  });
  it('above maxTotalCents → TOTAL_ABOVE_LIMIT', () => {
    const c = structuredClone(cfg);
    c.maxTotalCents = 5000;
    expect(code(() => priceMovie(c, { runtimeMinutes: 100, queueJumpTierId: 'topo' }, ctx()))).toBe(
      'TOTAL_ABOVE_LIMIT',
    );
  });
});

describe('rounding (mulBps)', () => {
  it.each([
    [1, 4999, 0], // 0.4999 → 0
    [1, 5000, 1], // 0.5 → 1 (half up)
    [1, 5001, 1],
    [3, 5000, 2], // 1.5 → 2
    [2100, 1250, 263],
    [6200, 8000, 4960],
    [10000, 16000, 16000],
    [12345, 0, 0],
    [12345, 1, 1],
    [12345, 9999, 12344],
    [12345, 10000, 12345],
  ])('mulBps(%i, %i) = %i', (a, b, want) => expect(mulBps(a, b)).toBe(want));
  it('rejects non-integers and negatives', () => {
    expect(() => mulBps(1.5, 1)).toThrow(RangeError);
    expect(() => mulBps(-1, 1)).toThrow(RangeError);
  });
  it('formats percentages in pt-BR', () => {
    expect(formatBps(8000)).toBe('80 %');
    expect(formatBps(1250)).toBe('12,5 %');
  });
});

describe('perks and vouchers', () => {
  const p = (over: Partial<PriceContext>) => priceMovie(cfg, { runtimeMinutes: 100 }, ctx(over));
  it('guest / USER: no perk; VIP and MODERATOR: 10 %', () => {
    expect(p({ perk: 'NONE' }).totalCents).toBe(2000);
    expect(p({ perk: 'VIP' }).totalCents).toBe(1800);
    expect(p({ perk: 'MODERATOR' }).totalCents).toBe(1800);
  });
  it('PERCENT with maxDiscountCents caps the discount', () =>
    expect(p({ voucher: voucher({ percentBps: 5000, maxDiscountCents: 300 }) }).totalCents).toBe(
      1700,
    ));
  it.each([
    [{ active: false }, 'VOUCHER_INVALID'],
    [{ startsAt: new Date('2026-11-01T00:00:00Z') }, 'VOUCHER_EXPIRED'],
    [{ endsAt: NOW }, 'VOUCHER_EXPIRED'],
    [{ maxRedemptions: 3, redemptionCount: 3 }, 'VOUCHER_SOLD_OUT'],
    [{ maxPerUser: 1, buyerRedemptions: 1 }, 'VOUCHER_USER_LIMIT'],
    [{ minSubtotalCents: 2100 }, 'VOUCHER_INVALID'],
    [{ kind: 'FIXED' as const, amountCents: null }, 'VOUCHER_INVALID'],
  ])('voucher %o → %s', (over, want) =>
    expect(code(() => p({ voucher: voucher(over) }))).toBe(want),
  );
  it('voucher valid until just before endsAt', () =>
    expect(p({ voucher: voucher({ endsAt: new Date(NOW.getTime() + 1) }) }).totalCents).toBe(1800));
});

describe('queue jump and add-ons', () => {
  it('unknown tier / disabled', () => {
    expect(
      code(() => priceMovie(cfg, { runtimeMinutes: 100, queueJumpTierId: 'vip' }, ctx())),
    ).toBe('QUEUE_JUMP_TIER_INVALID');
    const c = structuredClone(cfg);
    c.queueJump.enabled = false;
    expect(code(() => priceMovie(c, { runtimeMinutes: 100, queueJumpTierId: 'topo' }, ctx()))).toBe(
      'QUEUE_JUMP_DISABLED',
    );
  });
  it('add-ons: FIXED and PERCENT_OF_BASE, unknown/duplicate rejected', () => {
    const c = structuredClone(cfg);
    c.addOns = [
      {
        id: 'mensagem',
        label: 'Mensagem na tela',
        kinds: ['MOVIE'],
        active: true,
        pricing: { type: 'FIXED', cents: 300 },
      },
      {
        id: 'destaque',
        label: 'Destaque',
        kinds: ['MOVIE'],
        active: true,
        pricing: { type: 'PERCENT_OF_BASE', bps: 2500 },
      },
      {
        id: 'off',
        label: 'Inativo',
        kinds: ['MOVIE'],
        active: false,
        pricing: { type: 'FIXED', cents: 1 },
      },
    ];
    const b = priceMovie(c, { runtimeMinutes: 131, addOnIds: ['mensagem', 'destaque'] }, ctx());
    expect(b.addOnCents).toBe(300 + 525);
    expect(b.totalCents).toBe(2100 + 825);
    expect(code(() => priceMovie(c, { runtimeMinutes: 100, addOnIds: ['nope'] }, ctx()))).toBe(
      'ADDON_INVALID',
    );
    expect(code(() => priceMovie(c, { runtimeMinutes: 100, addOnIds: ['off'] }, ctx()))).toBe(
      'ADDON_INVALID',
    );
    expect(
      code(() => priceMovie(c, { runtimeMinutes: 100, addOnIds: ['mensagem', 'mensagem'] }, ctx())),
    ).toBe('ADDON_INVALID');
  });
});

describe('contributions (11 §2.2)', () => {
  it.each([
    [500, 10000, true],
    [1000, 10000, true],
    [10000, 10000, true],
    [499, 10000, false],
    [550, 10000, false],
    [600, 500, false],
    [200_100, 1_000_000, false],
  ])('%i against remaining %i → ok=%s', (amount, remaining, ok) =>
    expect(checkContribution(cfg, amount, remaining).ok).toBe(ok),
  );
  it('over the remaining amount says how much is left', () =>
    expect(checkContribution(cfg, 2000, 1500)).toEqual({
      ok: false,
      code: 'AMOUNT_ABOVE_REMAINING',
      remainingCents: 1500,
    }));
});

describe('properties (fast-check)', () => {
  const arbCtx = fc.record({
    runtime: fc.integer({ min: 1, max: 360 }),
    perk: fc.constantFrom('NONE', 'MODERATOR', 'VIP') as fc.Arbitrary<'NONE' | 'MODERATOR' | 'VIP'>,
    tier: fc.constantFrom(null, 'prioridade', 'topo'),
    v: fc.option(
      fc.oneof(
        fc.record({
          kind: fc.constant('PERCENT' as const),
          percentBps: fc.integer({ min: 1, max: 10000 }),
          amountCents: fc.constant(null),
        }),
        fc.record({
          kind: fc.constant('FIXED' as const),
          percentBps: fc.constant(null),
          amountCents: fc.integer({ min: 1, max: 100_000 }),
        }),
      ),
      { nil: null },
    ),
  });
  it('total = Σ lines, integers only, within [min, max], discount ≤ subtotal, Q independent of D', () => {
    fc.assert(
      fc.property(arbCtx, ({ runtime, perk, tier, v }) => {
        const c = ctx({ perk, voucher: v ? voucher(v) : null });
        const b = priceMovie(cfg, { runtimeMinutes: runtime, queueJumpTierId: tier }, c);
        const plain = priceMovie(cfg, { runtimeMinutes: runtime, queueJumpTierId: tier }, ctx());
        expect(sumLines(b)).toBe(b.totalCents);
        for (const l of b.lines)
          if (l.cents !== null) expect(Number.isSafeInteger(l.cents)).toBe(true);
        expect(b.totalCents).toBeGreaterThanOrEqual(cfg.minTotalCents);
        expect(b.totalCents).toBeLessThanOrEqual(cfg.maxTotalCents);
        expect(b.discountCents).toBeLessThanOrEqual(b.subtotalCents);
        expect(b.subtotalCents - b.discountCents).toBeGreaterThanOrEqual(cfg.minTotalCents);
        expect(b.queueJumpCents).toBe(plain.queueJumpCents);
        expect(b.lines.at(-1)).toEqual({ key: 'total', label: 'Total', cents: b.totalCents });
      }),
      { numRuns: 2000 },
    );
  });
  it('price is monotonic in runtime', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 359 }), (r) => {
        const a = priceMovie(cfg, { runtimeMinutes: r }, ctx()).totalCents;
        const b = priceMovie(cfg, { runtimeMinutes: r + 1 }, ctx()).totalCents;
        expect(b).toBeGreaterThanOrEqual(a);
      }),
    );
  });
});
