import 'server-only';
import type { Order, Prisma } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { campaignState } from '../catalog/campaigns';
import { db } from '../db';
import { Problems } from '../http/problem';
import { enqueue } from '../jobs/queues';
import { logger } from '../log';
import { cancelMpOrder, MercadoPagoError, mapOrderStatus } from '../payments/mercadopago';
import { releaseQueueJump } from '../pricing/queue-jump';
import { releaseVoucher } from '../pricing/vouchers';
import { publishCampaign, publishOrder } from '../realtime/publish';
import { OrderProblems } from './problems';

/**
 * What happens to an unpaid order (11 §2, 02 §3): it expires 35 minutes after checkout (Pix 30 min
 * + 5 min grace) or its buyer cancels it. Either way everything it held is given back in the same
 * transaction that moves it out of PENDING_PAYMENT: the movie reservation, the campaign's reserved
 * amount, the voucher redemption and the queue-jump slot.
 */
type Tx = Prisma.TransactionClient;
export const PIX_MINUTES = 30;
export const GRACE_MINUTES = 5;

type Holds = Pick<Order, 'id' | 'kind' | 'itemId' | 'campaignId' | 'totalCents'>;

/** Call ONLY in the transaction that moved the order out of PENDING_PAYMENT. */
export async function releaseHoldsInTx(tx: Tx, order: Holds): Promise<void> {
  if (order.kind === 'MOVIE') {
    await tx.catalogItem.updateMany({
      where: { id: order.itemId, reservedOrderId: order.id },
      data: { reservedUntil: null, reservedOrderId: null },
    });
  } else if (order.campaignId) {
    await tx.campaign.update({
      where: { id: order.campaignId },
      data: {
        reservedCents: { decrement: order.totalCents },
        remainingCents: { increment: order.totalCents },
        version: { increment: 1 },
      },
    });
  }
  await releaseVoucher(tx, order.id);
  await releaseQueueJump(tx, order.id);
  await tx.emailOutbox.updateMany({
    where: { orderId: order.id, template: 'ORDER_RECEIPT', status: 'HELD' },
    data: { status: 'CANCELLED', sealedToken: null },
  });
}

/** After commit: tell the order page and (for contributions) the campaign bar. */
export async function publishOrderState(orderId: string): Promise<void> {
  const o = await db().order.findUnique({
    where: { id: orderId },
    select: {
      publicCode: true,
      status: true,
      payment: { select: { status: true } },
      campaign: true,
    },
  });
  if (!o) return;
  const at = new Date().toISOString();
  await publishOrder(orderId, {
    type: 'status',
    code: o.publicCode,
    status: o.status,
    paymentStatus: o.payment?.status ?? 'PENDING',
    at,
  });
  if (o.campaign) {
    await publishCampaign(o.campaign.id, {
      type: 'progress',
      goalCents: o.campaign.goalCents,
      raisedCents: o.campaign.raisedCents,
      remainingCents: o.campaign.remainingCents,
      supporterCount: o.campaign.supporterCount,
      state: campaignState(o.campaign),
      at,
    });
  }
}

/** Move one PENDING order to EXPIRED (no-op if it already left PENDING). Returns true if it did. */
export async function expireOrderInTx(tx: Tx, orderId: string, now: Date): Promise<boolean> {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== 'PENDING_PAYMENT') return false;
  const res = await tx.order.updateMany({
    where: { id: orderId, status: 'PENDING_PAYMENT' },
    data: { status: 'EXPIRED', cancelledAt: now, version: { increment: 1 } },
  });
  if (res.count !== 1) return false;
  await releaseHoldsInTx(tx, order);
  await audit(
    {
      action: 'order.expired',
      actor: null,
      targetType: 'Order',
      targetId: orderId,
      metadata: { kind: order.kind },
    },
    tx,
  );
  return true;
}

/**
 * Sweep (worker, every minute): expire orders whose Pix expired more than the grace period ago,
 * then ask Mercado Pago to cancel the Pix so it can't be paid late.
 */
export async function expireDueOrders(now = new Date(), limit = 100): Promise<number> {
  const due = await db().order.findMany({
    where: {
      status: 'PENDING_PAYMENT',
      payment: { expiresAt: { lt: new Date(now.getTime() - GRACE_MINUTES * 60_000) } },
    },
    select: { id: true },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });
  let n = 0;
  for (const { id } of due) {
    const done = await db().$transaction((tx) => expireOrderInTx(tx, id, now));
    if (done) {
      n++;
      await publishOrderState(id);
      await enqueue.paymentCancel(id);
    }
  }
  if (n) logger.info({ expired: n }, 'orders expired');
  return n;
}

/**
 * Cancel the Pix at Mercado Pago (job after expiry/cancel). Idempotent; when MP refuses because
 * the payment already went through, a sync turns that into a late approval for the streamer.
 */
export async function cancelPixAtProvider(
  orderId: string,
): Promise<'cancelled' | 'skipped' | 'synced'> {
  const p = await db().payment.findUnique({ where: { orderId } });
  if (!p?.providerOrderId || p.status !== 'PENDING') return 'skipped';
  try {
    const mp = await cancelMpOrder(p.providerOrderId, `cancel-${p.id}`);
    await db().payment.updateMany({
      where: { id: p.id, status: 'PENDING' },
      data: {
        status:
          mapOrderStatus(mp.status, mp.status_detail) === 'CANCELLED' ? 'CANCELLED' : 'PENDING',
        providerStatus: mp.status,
        statusDetail: mp.status_detail ?? null,
        lastSyncedAt: new Date(),
        version: { increment: 1 },
      },
    });
    return 'cancelled';
  } catch (err) {
    if (err instanceof MercadoPagoError && err.kind === 'rejected') {
      await enqueue.paymentSync(p.providerOrderId, 'order');
      return 'synced';
    }
    throw err; // unavailable → BullMQ retries with backoff
  }
}

/** The buyer cancels an unpaid order (03 §5.3). */
export async function cancelByBuyer(orderId: string, now = new Date()): Promise<void> {
  const order = await db().order.findUnique({ where: { id: orderId }, include: { payment: true } });
  if (!order) throw Problems.notFound();
  if (order.status !== 'PENDING_PAYMENT') throw OrderProblems.notCancellable();
  const p = order.payment;
  if (p?.providerOrderId) {
    try {
      const mp = await cancelMpOrder(p.providerOrderId, `cancel-${p.id}`);
      if (mapOrderStatus(mp.status, mp.status_detail) !== 'CANCELLED') {
        throw OrderProblems.notCancellable();
      }
    } catch (err) {
      if (err instanceof MercadoPagoError) {
        if (err.kind === 'rejected') {
          // Probably paid a moment ago — let the sync decide, and tell the buyer to refresh.
          await enqueue.paymentSync(p.providerOrderId, 'order');
          throw OrderProblems.notCancellable();
        }
        throw Problems.unavailable();
      }
      throw err;
    }
  }
  const done = await db().$transaction(async (tx) => {
    const res = await tx.order.updateMany({
      where: { id: orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED', cancelledAt: now, version: { increment: 1 } },
    });
    if (res.count !== 1) return false;
    if (p) {
      await tx.payment.update({
        where: { id: p.id },
        data: { status: 'CANCELLED', lastSyncedAt: now, version: { increment: 1 } },
      });
    }
    await releaseHoldsInTx(tx, order);
    await audit(
      {
        action: 'order.cancelled',
        actor: null,
        targetType: 'Order',
        targetId: orderId,
        metadata: { kind: order.kind, by: 'buyer' },
      },
      tx,
    );
    return true;
  });
  if (!done) throw OrderProblems.notCancellable();
  await publishOrderState(orderId);
}
