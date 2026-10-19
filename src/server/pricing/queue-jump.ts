import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { PricingConfig, QueueJumpTier } from '@/lib/pricing/config';
import { businessDayDate, isoWeek } from '@/lib/time/business-day';
import { HttpError } from '../http/problem';

/**
 * Queue-jump caps (04 §5) without serialisable transactions: a reservation claims the lowest free
 * (day, dayIndex) for the shared daily cap, (isoWeek, weekIndex) for the weekly cap and — for tiers
 * with their own cap ("topo": 1/day) — (day, tierId, tierIndex). The unique indexes make
 * over-allocation impossible; two buyers racing for the same index make one transaction fail with
 * a unique violation, and the order writer retries the whole transaction (bounded).
 * Released reservations are deleted (freeing the indexes); history stays in Order.breakdown.
 */
export const QueueJumpProblems = {
  soldOut: () =>
    new HttpError(
      409,
      'QUEUE_JUMP_SOLD_OUT',
      'Os furos de fila de hoje (ou desta semana) acabaram. Tente sem o adicional.',
    ),
  buyerLimit: () =>
    new HttpError(
      409,
      'QUEUE_JUMP_BUYER_LIMIT',
      'Você já usou um furo de fila hoje. Tente amanhã ou sem o adicional.',
    ),
};

function lowestFree(used: number[], cap: number): number | null {
  const taken = new Set(used);
  for (let i = 0; i < cap; i++) if (!taken.has(i)) return i;
  return null;
}

export async function reserveQueueJump(
  tx: Prisma.TransactionClient,
  config: PricingConfig,
  tier: QueueJumpTier,
  r: { orderId: string; buyerKey: string; now: Date; expiresAt: Date },
): Promise<void> {
  const q = config.queueJump;
  const day = businessDayDate(r.now);
  const week = isoWeek(r.now);

  const buyerToday = await tx.queueJumpSlot.count({
    where: { day, order: { buyerKey: r.buyerKey } },
  });
  if (buyerToday >= q.perBuyerDailyCap) throw QueueJumpProblems.buyerLimit();

  const [dayRows, weekRows, tierRows] = await Promise.all([
    tx.queueJumpSlot.findMany({ where: { day }, select: { dayIndex: true } }),
    tx.queueJumpSlot.findMany({ where: { isoWeek: week }, select: { weekIndex: true } }),
    tier.dailyCap
      ? tx.queueJumpSlot.findMany({ where: { day, tierId: tier.id }, select: { tierIndex: true } })
      : Promise.resolve([]),
  ]);
  const dayIndex = lowestFree(
    dayRows.map((x) => x.dayIndex),
    q.dailyCap,
  );
  const weekIndex = lowestFree(
    weekRows.map((x) => x.weekIndex),
    q.weeklyCap,
  );
  const tierIndex = tier.dailyCap
    ? lowestFree(
        tierRows.map((x) => x.tierIndex ?? -1),
        tier.dailyCap,
      )
    : null;
  if (dayIndex === null || weekIndex === null || (tier.dailyCap && tierIndex === null)) {
    throw QueueJumpProblems.soldOut();
  }
  await tx.queueJumpSlot.create({
    data: {
      orderId: r.orderId,
      day,
      tierId: tier.id,
      dayIndex,
      isoWeek: week,
      weekIndex,
      tierIndex,
      multiplierBps: tier.bps,
      expiresAt: r.expiresAt,
    },
  });
}

/** Expired/cancelled order: free the slot (idempotent). */
export async function releaseQueueJump(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  await tx.queueJumpSlot.deleteMany({ where: { orderId, confirmed: false } });
}

/** Approved payment: the slot is the buyer's (idempotent). */
export async function confirmQueueJump(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  await tx.queueJumpSlot.updateMany({ where: { orderId }, data: { confirmed: true } });
}
