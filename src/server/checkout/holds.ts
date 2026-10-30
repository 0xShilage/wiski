import 'server-only';
import type { Order, Prisma } from '@/generated/prisma/client';
import { logger } from '../log';

type Tx = Prisma.TransactionClient;
type HoldOrder = Pick<Order, 'id' | 'kind' | 'itemId' | 'campaignId' | 'totalCents'>;

/**
 * What an unpaid order holds while its Pix is pending (11 §7 concurrency, 04 §5–§6): the movie
 * (CatalogItem.reservedOrderId), the campaign amount (Campaign.reservedCents), a voucher
 * redemption and a queue-jump slot. Both functions run inside the transaction that moves the
 * order OUT of PENDING_PAYMENT with a version compare-and-set, so each runs exactly once per order.
 */

/** Expired / cancelled / rejected / failed to create: give everything back. */
export async function releaseHolds(
  t: Tx,
  o: HoldOrder,
  opts: { extrasOnly?: boolean } = {},
): Promise<void> {
  if (opts.extrasOnly) {
    // the movie / campaign hold is already gone: only voucher + queue slot
  } else if (o.kind === 'MOVIE') {
    await t.catalogItem.updateMany({
      where: { id: o.itemId, reservedOrderId: o.id },
      data: { reservedUntil: null, reservedOrderId: null },
    });
  } else if (o.campaignId) {
    const res = await t.campaign.updateMany({
      where: { id: o.campaignId, reservedCents: { gte: o.totalCents } },
      data: {
        reservedCents: { decrement: o.totalCents },
        remainingCents: { increment: o.totalCents },
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) {
      logger.error({ alert: 'payments', orderId: o.id }, 'campaign reservation missing on release');
    }
  }
  const vr = await t.voucherRedemption.findUnique({ where: { orderId: o.id } });
  if (vr && vr.status === 'RESERVED') {
    await t.voucherRedemption.update({ where: { id: vr.id }, data: { status: 'RELEASED' } });
    await t.voucher.updateMany({
      where: { id: vr.voucherId, redemptionCount: { gt: 0 } },
      data: { redemptionCount: { decrement: 1 } },
    });
  }
  await t.queueJumpSlot.deleteMany({ where: { orderId: o.id, confirmed: false } });
}

export type ConfirmResult = { ok: true; funded: boolean } | { ok: false; reason: 'hold-lost' };

/**
 * Payment approved in time: turn the holds into the sale. The movie must still be reserved by
 * this order (else → NEEDS_ATTENTION, never a second sponsor); a contribution moves from
 * reserved to raised, and the campaign completes when raised reaches the goal.
 */
export async function confirmHolds(t: Tx, o: HoldOrder, now: Date): Promise<ConfirmResult> {
  let funded = false;
  if (o.kind === 'MOVIE') {
    const res = await t.catalogItem.updateMany({
      where: { id: o.itemId, reservedOrderId: o.id, status: 'ACTIVE' },
      data: { status: 'SPONSORED', reservedUntil: null, reservedOrderId: null },
    });
    if (res.count !== 1) return { ok: false, reason: 'hold-lost' };
  } else {
    if (!o.campaignId) return { ok: false, reason: 'hold-lost' };
    const res = await t.campaign.updateMany({
      where: { id: o.campaignId, reservedCents: { gte: o.totalCents } },
      data: {
        reservedCents: { decrement: o.totalCents },
        raisedCents: { increment: o.totalCents },
        supporterCount: { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) return { ok: false, reason: 'hold-lost' };
    const c = await t.campaign.findUniqueOrThrow({ where: { id: o.campaignId } });
    if (c.raisedCents === c.goalCents && c.reservedCents === 0 && c.status === 'OPEN') {
      await t.campaign.update({
        where: { id: c.id },
        data: { status: 'FUNDED', fundedAt: now, version: { increment: 1 } },
      });
      await t.catalogItem.updateMany({
        where: { id: c.itemId, status: 'ACTIVE' },
        data: { status: 'FUNDED' },
      });
      funded = true;
    }
  }
  await t.voucherRedemption.updateMany({
    where: { orderId: o.id, status: 'RESERVED' },
    data: { status: 'CONSUMED' },
  });
  await t.queueJumpSlot.updateMany({ where: { orderId: o.id }, data: { confirmed: true } });
  return { ok: true, funded };
}
