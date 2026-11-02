import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * PricingConfig v1 (04 §2), reduced to what the redesign sells (11 §2): one MOVIE kind priced by
 * runtime bands, the optional add-ons list (none configured), the fixed queue-jump tiers, the
 * moderator/VIP perk, and the limits for campaign contributions. Stored as JSON in
 * PriceRuleSet.config, validated by this schema on write AND on read; `configHash` is the SHA-256
 * of the canonical JSON and is pinned by every movie order.
 *
 * No I/O here: the module is imported by the pure engine, tests and the migration generator.
 */
const cents = z.int().nonnegative().max(100_000_000);
const bps = z.int().min(0).max(100_000);
const tierId = z.string().regex(/^[a-z][a-z0-9-]{1,23}$/);

const bandsPricing = z
  .object({
    mode: z.literal('RUNTIME_BANDS'),
    bands: z
      .array(z.object({ upToMinutes: z.int().min(1).max(1000), baseCents: cents }).strict())
      .min(1)
      .max(10),
    perMinuteOverCents: cents,
  })
  .strict()
  .refine((p) => p.bands.every((b, i) => i === 0 || b.upToMinutes > p.bands[i - 1]!.upToMinutes), {
    message: 'bands must have strictly increasing upToMinutes',
  });

const kindRule = z
  .object({
    enabled: z.boolean(),
    minRuntimeMinutes: z.int().min(1).max(1000),
    maxRuntimeMinutes: z.int().min(1).max(1000),
    pricing: bandsPricing,
  })
  .strict()
  .refine((k) => k.minRuntimeMinutes <= k.maxRuntimeMinutes, {
    message: 'minRuntimeMinutes must be ≤ maxRuntimeMinutes',
  });

const addOn = z
  .object({
    id: tierId,
    label: z.string().min(1).max(60),
    kinds: z.array(z.literal('MOVIE')).min(1),
    active: z.boolean(),
    pricing: z.discriminatedUnion('type', [
      z.object({ type: z.literal('FIXED'), cents }).strict(),
      z.object({ type: z.literal('PERCENT_OF_BASE'), bps }).strict(),
    ]),
  })
  .strict();

const queueJumpTier = z
  .object({
    id: tierId,
    label: z.string().min(1).max(40),
    bps: z.int().min(8000).max(16000), // 04 §2 — also a DB CHECK on QueueJumpSlot
    placement: z.enum(['AHEAD_OF_REGULAR', 'TOP']),
    dailyCap: z.int().min(1).max(100).optional(),
  })
  .strict();

export const pricingConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    currency: z.literal('BRL'),
    minTotalCents: cents.min(100),
    maxTotalCents: cents,
    kinds: z.object({ MOVIE: kindRule }).strict(),
    addOns: z.array(addOn).max(20),
    queueJump: z
      .object({
        enabled: z.boolean(),
        tiers: z.array(queueJumpTier).max(5),
        dailyCap: z.int().min(0).max(100),
        weeklyCap: z.int().min(0).max(500),
        perBuyerDailyCap: z.int().min(0).max(10),
        reservationTtlMinutes: z.int().min(31).max(120),
      })
      .strict(),
    discounts: z
      .object({
        moderatorBps: bps.max(10000),
        vipBps: bps.max(10000),
        stacking: z.literal('BEST_SINGLE'),
        discountsApplyToQueueJump: z.literal(false),
      })
      .strict(),
    contributions: z
      .object({
        minCents: cents.min(100),
        stepCents: z.int().min(1).max(100_000),
        maxCents: cents,
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.minTotalCents > c.maxTotalCents) {
      ctx.addIssue({ code: 'custom', path: ['maxTotalCents'], message: 'must be ≥ minTotalCents' });
    }
    const ids = c.queueJump.tiers.map((t) => t.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['queueJump', 'tiers'], message: 'duplicate tier id' });
    }
    if (c.contributions.minCents % c.contributions.stepCents !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'minCents'],
        message: 'must be a multiple of stepCents',
      });
    }
  });

export type PricingConfig = z.infer<typeof pricingConfigSchema>;
export type QueueJumpTier = PricingConfig['queueJump']['tiers'][number];

/**
 * Rule set rev 3 (04 §3), the values the site launched with. The Phase 2 reviewed migration
 * inserts exactly this object as the ACTIVE PriceRuleSet; a test keeps the two identical, and
 * src/lib/catalog/pricing.ts (prices shown on public pages) mirrors it.
 */
export const RULESET_REV3: PricingConfig = {
  schemaVersion: 1,
  currency: 'BRL',
  minTotalCents: 500,
  maxTotalCents: 200_000,
  kinds: {
    MOVIE: {
      enabled: true,
      minRuntimeMinutes: 1,
      maxRuntimeMinutes: 360,
      pricing: {
        mode: 'RUNTIME_BANDS',
        bands: [{ upToMinutes: 130, baseCents: 2000 }],
        perMinuteOverCents: 100,
      },
    },
  },
  addOns: [],
  queueJump: {
    enabled: true,
    tiers: [
      { id: 'prioridade', label: 'Prioridade', bps: 8000, placement: 'AHEAD_OF_REGULAR' },
      { id: 'topo', label: 'Topo da fila', bps: 16000, placement: 'TOP', dailyCap: 1 },
    ],
    dailyCap: 5,
    weeklyCap: 20,
    perBuyerDailyCap: 1,
    reservationTtlMinutes: 35,
  },
  discounts: {
    moderatorBps: 1000,
    vipBps: 1000,
    stacking: 'BEST_SINGLE',
    discountsApplyToQueueJump: false,
  },
  contributions: { minCents: 500, stepCents: 100, maxCents: 200_000 },
};

/** Canonical JSON: object keys sorted (recursively), no whitespace. Arrays keep their order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function configHash(config: unknown): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(canonicalJson(config), 'utf8').digest());
}
