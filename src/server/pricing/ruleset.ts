import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '../db';
import { logger } from '../log';
import { safeEqual } from '../security/crypto';
import { configHash, type PricingConfig, pricingConfigSchema } from './config';

export type ActiveRuleSet = { id: string; version: number; config: PricingConfig };

type Tx = Prisma.TransactionClient;
const TTL_MS = 30_000;
let cached: { at: number; value: ActiveRuleSet | null } | undefined;

/**
 * The ACTIVE PriceRuleSet (04 §1.4), validated on read: the JSON must parse as PricingConfig v1
 * AND hash to the stored configHash. Anything else → null, and checkout stays closed (fail
 * closed: never a fallback price). Cached 30 s per process.
 */
export async function activeRuleSet(tx?: Tx): Promise<ActiveRuleSet | null> {
  if (!tx && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const row = await (tx ?? db()).priceRuleSet.findFirst({ where: { status: 'ACTIVE' } });
  let value: ActiveRuleSet | null = null;
  if (row) {
    const parsed = pricingConfigSchema.safeParse(row.config);
    if (!parsed.success) {
      logger.error({ ruleSetId: row.id, alert: 'pricing' }, 'active rule set fails validation');
    } else if (!safeEqual(configHash(row.config), row.configHash)) {
      logger.error({ ruleSetId: row.id, alert: 'pricing' }, 'active rule set hash mismatch');
    } else {
      value = { id: row.id, version: row.version, config: parsed.data };
    }
  }
  if (!tx) cached = { at: Date.now(), value };
  return value;
}

/** Tests / admin publish. */
export function resetRuleSetCache(): void {
  cached = undefined;
}
