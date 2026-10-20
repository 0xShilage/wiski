import 'server-only';
import type { PriceRuleSet } from '@/generated/prisma/client';
import {
  canonicalJson,
  DEFAULT_PRICING_CONFIG,
  type PricingConfig,
  pricingConfigSchema,
} from '@/lib/pricing/config';
import { db } from '../db';
import { PG, pgErrorCode } from '../db-errors';
import { logger } from '../log';
import { sha256Bytes } from '../security/crypto';

/**
 * Versioned price rules (04 §1.4): exactly one ACTIVE PriceRuleSet (partial unique), immutable
 * once active; every movie order pins its id and the full breakdown. Phase 2 bootstraps the 04 §3
 * configuration as the first ACTIVE version; the STREAMER's publish screen arrives in Phase 4.
 */
export type ActiveRuleSet = { id: string; version: number; config: PricingConfig };

const TTL_MS = 30_000;
let cache: { value: ActiveRuleSet; at: number } | null = null;

export function configHash(config: PricingConfig): Uint8Array<ArrayBuffer> {
  return sha256Bytes(canonicalJson(config));
}

function toActive(row: PriceRuleSet): ActiveRuleSet {
  const parsed = pricingConfigSchema.safeParse(row.config);
  if (!parsed.success) {
    // Fail closed: never price with a config the code doesn't understand.
    logger.error({ ruleSetId: row.id, version: row.version }, 'active price rule set is invalid');
    throw new Error('active PriceRuleSet does not validate');
  }
  return { id: row.id, version: row.version, config: parsed.data };
}

/** Create the default rule set as the next version when no version is ACTIVE (idempotent). */
export async function ensureActiveRuleSet(now = new Date()): Promise<ActiveRuleSet> {
  const active = await db().priceRuleSet.findFirst({ where: { status: 'ACTIVE' } });
  if (active) return toActive(active);
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await db().priceRuleSet.findFirst({ orderBy: { version: 'desc' } });
    try {
      const row = await db().priceRuleSet.create({
        data: {
          version: (last?.version ?? 0) + 1,
          status: 'ACTIVE',
          config: DEFAULT_PRICING_CONFIG,
          configHash: configHash(DEFAULT_PRICING_CONFIG),
          publishedAt: now,
        },
      });
      logger.info({ version: row.version }, 'default price rule set activated');
      return toActive(row);
    } catch (err) {
      if (pgErrorCode(err) !== PG.uniqueViolation) throw err;
      // Someone else activated one (or took the version number) — read again.
      const again = await db().priceRuleSet.findFirst({ where: { status: 'ACTIVE' } });
      if (again) return toActive(again);
    }
  }
  throw new Error('could not activate a price rule set');
}

/** The ACTIVE rule set (cached for 30 s per process). */
export async function activeRuleSet(): Promise<ActiveRuleSet> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await ensureActiveRuleSet();
  cache = { value, at: Date.now() };
  return value;
}

/** Test helper. */
export function resetRuleSetCache(): void {
  cache = null;
}
