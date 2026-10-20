import { z } from 'zod';
import {
  MOVIE_BASE_CENTS,
  MOVIE_BASE_UP_TO_MIN,
  MOVIE_MAX_RUNTIME,
  MOVIE_PER_EXTRA_MIN_CENTS,
} from '@/lib/catalog/pricing';

/**
 * PricingConfig v1 (04 §2), the redesign subset: only movies are priced by the engine — campaign
 * contributions are free whole-real amounts (11 §2.2), and series/anime packages, YouTube and
 * add-ons left the product (11 §10). Stored as JSON in PriceRuleSet.config and validated by this
 * schema on write AND on read; integers only.
 */
const cents = z.int().min(0).max(100_000_000);
const bps = z.int().min(0).max(10_000);

export const queueJumpTierSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,23}$/),
    label: z.string().min(1).max(30),
    /** surcharge on the pre-discount subtotal: 8000..16000 bps (also a DB CHECK on the slot) */
    bps: z.int().min(8000).max(16_000),
    placement: z.enum(['AHEAD_OF_REGULAR', 'TOP']),
    /** optional per-tier cap inside the shared daily cap */
    dailyCap: z.int().min(1).max(100).optional(),
  })
  .strict();

export const pricingConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    currency: z.literal('BRL'),
    minTotalCents: cents.min(100),
    maxTotalCents: cents.min(100),
    movie: z
      .object({
        minRuntimeMinutes: z.int().min(1).max(MOVIE_MAX_RUNTIME),
        maxRuntimeMinutes: z.int().min(1).max(MOVIE_MAX_RUNTIME),
        bands: z
          .array(
            z
              .object({
                upToMinutes: z.int().min(1).max(MOVIE_MAX_RUNTIME),
                baseCents: cents.min(1),
              })
              .strict(),
          )
          .min(1)
          .max(10),
        perMinuteOverCents: cents,
      })
      .strict(),
    queueJump: z
      .object({
        enabled: z.boolean(),
        tiers: z.array(queueJumpTierSchema).max(5),
        /** shared by all tiers, per America/Sao_Paulo calendar day */
        dailyCap: z.int().min(0).max(100),
        /** shared, per ISO week (Mon–Sun, America/Sao_Paulo) */
        weeklyCap: z.int().min(0).max(500),
        /** buyer = user id, or the normalised contact e-mail */
        perBuyerDailyCap: z.int().min(1).max(10),
        /** Pix expiry (30 min) + grace (5 min) */
        reservationTtlMinutes: z.int().min(30).max(60),
      })
      .strict(),
    discounts: z
      .object({
        moderatorBps: bps,
        vipBps: bps,
        stacking: z.literal('BEST_SINGLE'),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (c.minTotalCents > c.maxTotalCents) issue(['minTotalCents'], 'min > max');
    if (c.movie.minRuntimeMinutes > c.movie.maxRuntimeMinutes) {
      issue(['movie', 'minRuntimeMinutes'], 'min > max');
    }
    c.movie.bands.forEach((b, i) => {
      if (i > 0 && b.upToMinutes <= c.movie.bands[i - 1]!.upToMinutes) {
        issue(['movie', 'bands', i, 'upToMinutes'], 'bands must be strictly increasing');
      }
    });
    const ids = c.queueJump.tiers.map((t) => t.id);
    if (new Set(ids).size !== ids.length) issue(['queueJump', 'tiers'], 'duplicate tier id');
    if (c.queueJump.weeklyCap < c.queueJump.dailyCap) {
      issue(['queueJump', 'weeklyCap'], 'weekly cap below daily cap');
    }
  });

export type PricingConfig = z.infer<typeof pricingConfigSchema>;
export type QueueJumpTier = z.infer<typeof queueJumpTierSchema>;

/** The active configuration of 04 §3 (rev 3) — rule set version 1. */
export const DEFAULT_PRICING_CONFIG: PricingConfig = Object.freeze({
  schemaVersion: 1,
  currency: 'BRL',
  minTotalCents: 500,
  maxTotalCents: 200_000,
  movie: {
    minRuntimeMinutes: 1,
    maxRuntimeMinutes: MOVIE_MAX_RUNTIME,
    bands: [{ upToMinutes: MOVIE_BASE_UP_TO_MIN, baseCents: MOVIE_BASE_CENTS }],
    perMinuteOverCents: MOVIE_PER_EXTRA_MIN_CENTS,
  },
  queueJump: {
    enabled: true,
    tiers: [
      { id: 'prioridade', label: 'Prioridade', bps: 8000, placement: 'AHEAD_OF_REGULAR' },
      { id: 'topo', label: 'Topo da fila', bps: 16_000, placement: 'TOP', dailyCap: 1 },
    ],
    dailyCap: 5,
    weeklyCap: 20,
    perBuyerDailyCap: 1,
    reservationTtlMinutes: 35,
  },
  discounts: { moderatorBps: 1000, vipBps: 1000, stacking: 'BEST_SINGLE' },
}) as PricingConfig;

export { canonicalJson } from '@/lib/canonical-json';
