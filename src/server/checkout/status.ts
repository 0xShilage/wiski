import 'server-only';
import type { LegalDocType } from '@/generated/prisma/enums';
import { db } from '../db';
import { isMpConfigured } from '../payments/mercadopago/client';
import { activeRuleSet } from '../pricing/ruleset';

/**
 * Whether checkout is open, and why not (fail closed — 04 §1.5, 05 §12). Checkout needs:
 * Mercado Pago credentials (access token + collector id), an ACTIVE valid price rule set, a
 * current version of each legal text the buyer accepts (Q13), and the streamer's switch
 * (AppSetting "orders.open", default on).
 */
export type CheckoutClosedReason =
  'PAYMENTS_NOT_CONFIGURED' | 'NO_PRICES' | 'NO_LEGAL_TEXTS' | 'CLOSED_BY_STREAMER';
export type CheckoutStatus = { open: true } | { open: false; reason: CheckoutClosedReason };

export const LEGAL_TYPES: readonly LegalDocType[] = ['TERMS', 'PRIVACY', 'REFUND'];

export type CurrentLegal = Record<LegalDocType, { id: string; version: string }>;

export async function currentLegal(): Promise<CurrentLegal | null> {
  const docs = await db().legalDocument.findMany({
    where: { isCurrent: true },
    select: { id: true, type: true, version: true },
  });
  const out: Partial<CurrentLegal> = {};
  for (const d of docs) out[d.type] = { id: d.id, version: d.version };
  return LEGAL_TYPES.every((t) => out[t]) ? (out as CurrentLegal) : null;
}

export async function checkoutStatus(): Promise<CheckoutStatus> {
  if (!isMpConfigured()) return { open: false, reason: 'PAYMENTS_NOT_CONFIGURED' };
  if (!(await activeRuleSet())) return { open: false, reason: 'NO_PRICES' };
  if (!(await currentLegal())) return { open: false, reason: 'NO_LEGAL_TEXTS' };
  const flag = await db().appSetting.findUnique({ where: { key: 'orders.open' } });
  if (flag && flag.value === false) return { open: false, reason: 'CLOSED_BY_STREAMER' };
  return { open: true };
}

/** pt-BR notice for each closed state (shown instead of the checkout form). */
export const CLOSED_COPY: Record<CheckoutClosedReason, string> = {
  PAYMENTS_NOT_CONFIGURED: 'Os pagamentos com Pix ainda não estão ativos neste ambiente.',
  NO_PRICES: 'Os pagamentos estão temporariamente indisponíveis.',
  NO_LEGAL_TEXTS: 'Os pagamentos abrem assim que os termos definitivos forem publicados.',
  CLOSED_BY_STREAMER: 'Os patrocínios estão pausados no momento. Volte em breve!',
};
