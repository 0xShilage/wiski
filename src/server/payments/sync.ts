import 'server-only';
import type { AttentionReason, PaymentStatus } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { db } from '../db';
import { queueFundedNotices } from '../email/outbox';
import { getEnv } from '../env';
import { enqueue } from '../jobs/queues';
import { logger } from '../log';
import { publishOrderState, releaseHoldsInTx } from '../orders/lifecycle';
import { confirmQueueJump } from '../pricing/queue-jump';
import { consumeVoucher } from '../pricing/vouchers';
import {
  getMpOrder,
  mapOrderStatus,
  type MappedStatus,
  type MpOrder,
  pixPaymentOf,
} from './mercadopago';

/**
 * payment.sync (05 §6 steps 8–10, adapted to the Orders API): read the order from Mercado Pago —
 * never trust the webhook body — verify it is ours and for the right amount, then apply a
 * forward-only state transition with its side effects in ONE transaction:
 *
 *   approved + order pending  → order PAID, movie SPONSORED / campaign reserved→raised (goal
 *                               reached → FUNDED), voucher + queue-jump slot consumed, receipt queued
 *   approved + order expired  → NEEDS_ATTENTION (LATE_APPROVAL) — the streamer decides
 *   any identity/amount doubt → NEEDS_ATTENTION, never PAID
 *   cancelled/failed + pending → EXPIRED/CANCELLED, holds released
 *   refunded / charged back    → REFUNDED (our refund) or NEEDS_ATTENTION
 *
 * Concurrency: `Payment.version` (optimistic) + the provider's last_updated_date (monotonic), so
 * two workers or out-of-order notifications can never move a payment backwards.
 */
export type SyncOutcome =
  | 'paid'
  | 'late-approval'
  | 'attention'
  | 'closed'
  | 'refunded'
  | 'unchanged'
  | 'stale'
  | 'foreign';

const NEXT: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['IN_PROCESS', 'APPROVED', 'REJECTED', 'CANCELLED'],
  IN_PROCESS: ['APPROVED', 'REJECTED', 'CANCELLED'],
  AUTHORIZED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['REFUNDED', 'CHARGED_BACK', 'IN_MEDIATION'],
  IN_MEDIATION: ['APPROVED', 'CHARGED_BACK', 'REFUNDED'],
  REJECTED: [],
  CANCELLED: [],
  REFUNDED: [],
  CHARGED_BACK: [],
};

export function canMove(from: PaymentStatus, to: PaymentStatus): boolean {
  return NEXT[from].includes(to);
}

const PAID_LIKE = ['PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** Identity and amount checks (05 §6 step 8). Null = all good. */
export function verifyMpOrder(
  mp: MpOrder,
  ours: { orderId: string; amountCents: number; providerOrderId: string | null },
): AttentionReason | null {
  const env = getEnv();
  if (mp.external_reference !== ours.orderId) return 'ACCOUNT_MISMATCH';
  if (ours.providerOrderId && ours.providerOrderId !== mp.id) return 'ACCOUNT_MISMATCH';
  if (!mp.user_id || mp.user_id !== env.MP_COLLECTOR_ID) return 'ACCOUNT_MISMATCH';
  const app = mp.integration_data?.application_id;
  if (env.MP_APPLICATION_ID && app && app !== env.MP_APPLICATION_ID) return 'ACCOUNT_MISMATCH';
  const pay = pixPaymentOf(mp);
  if (!pay || pay.payment_method?.id !== 'pix') return 'AMOUNT_MISMATCH';
  if (mp.total_amount !== ours.amountCents || pay.amount !== ours.amountCents)
    return 'AMOUNT_MISMATCH';
  if (
    pay.paid_amount !== null &&
    pay.paid_amount !== undefined &&
    pay.paid_amount !== 0 &&
    pay.paid_amount !== ours.amountCents
  ) {
    return 'AMOUNT_MISMATCH';
  }
  return null;
}

type Loaded = Prisma.PaymentGetPayload<{ include: { order: true } }>;

async function loadPayment(mp: MpOrder): Promise<Loaded | null> {
  const byProvider = await db().payment.findUnique({
    where: { providerOrderId: mp.id },
    include: { order: true },
  });
  if (byProvider) return byProvider;
  // Created but our write of providerOrderId didn't happen (crash between MP and DB).
  const ref = mp.external_reference ?? '';
  if (!UUID.test(ref)) return null;
  const p = await db().payment.findUnique({ where: { orderId: ref }, include: { order: true } });
  return p && p.providerOrderId === null ? p : null;
}

export async function syncMpOrder(
  mpOrderId: string,
  source: 'webhook' | 'reconcile' | 'order' = 'reconcile',
  now = new Date(),
): Promise<SyncOutcome> {
  const mp = await getMpOrder(mpOrderId); // unavailable → throws → BullMQ retries
  const p = await loadPayment(mp);
  if (!p) {
    logger.warn({ mpOrderId: mp.id.slice(0, 12) }, 'sync: order is not ours');
    return 'foreign';
  }
  const mapped: MappedStatus | null = mapOrderStatus(mp.status, mp.status_detail);
  const updatedAt = parseDate(mp.last_updated_date);
  if (p.providerUpdatedAt && updatedAt && updatedAt < p.providerUpdatedAt) return 'stale';
  const problem = verifyMpOrder(mp, {
    orderId: p.orderId,
    amountCents: p.amountCents,
    providerOrderId: p.providerOrderId,
  });
  const pay = pixPaymentOf(mp);
  const raw = {
    providerOrderId: p.providerOrderId ?? mp.id,
    providerPaymentId: p.providerPaymentId ?? pay?.id ?? null,
    providerStatus: mp.status.slice(0, 40),
    statusDetail: (mp.status_detail ?? null)?.slice(0, 60) ?? null,
    providerUpdatedAt: updatedAt ?? p.providerUpdatedAt,
    lastSyncedAt: now,
  };

  if (!mapped) {
    logger.warn({ status: mp.status.slice(0, 40) }, 'sync: unknown provider status');
    await db().payment.updateMany({ where: { id: p.id, version: p.version }, data: raw });
    return 'unchanged';
  }

  const outcome = await db().$transaction(async (tx): Promise<SyncOutcome> => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: p.orderId } });
    const moving = mapped !== p.status && canMove(p.status, mapped);
    const status = moving ? mapped : p.status;
    const res = await tx.payment.updateMany({
      where: { id: p.id, version: p.version },
      data: {
        ...raw,
        status,
        ...(moving && mapped === 'APPROVED' ? { approvedAt: now } : {}),
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) return 'unchanged'; // a concurrent sync got there first
    if (!moving) return 'unchanged';

    const attention = async (reason: AttentionReason): Promise<SyncOutcome> => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'NEEDS_ATTENTION', attentionReason: reason, version: { increment: 1 } },
      });
      await audit(
        {
          action: 'order.attention',
          actor: null,
          targetType: 'Order',
          targetId: order.id,
          metadata: { kind: order.kind, reason },
        },
        tx,
      );
      return reason === 'LATE_APPROVAL' ? 'late-approval' : 'attention';
    };

    switch (mapped) {
      case 'APPROVED': {
        if (problem) {
          // Money arrived but something doesn't match: hold everything for the streamer.
          if (order.status === 'PENDING_PAYMENT') await releaseHoldsInTx(tx, order);
          return attention(problem);
        }
        if (order.status === 'PENDING_PAYMENT') {
          await markPaidInTx(tx, order, source, now);
          return 'paid';
        }
        if (order.status === 'EXPIRED' || order.status === 'CANCELLED') {
          return attention('LATE_APPROVAL');
        }
        return 'unchanged';
      }
      case 'REJECTED':
      case 'CANCELLED': {
        if (order.status !== 'PENDING_PAYMENT') return 'unchanged';
        const expired = (mp.status_detail ?? '').toLowerCase() === 'expired';
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: expired ? 'EXPIRED' : 'CANCELLED',
            cancelledAt: now,
            version: { increment: 1 },
          },
        });
        await releaseHoldsInTx(tx, order);
        const target = { actor: null, targetType: 'Order', targetId: order.id } as const;
        if (expired) {
          await audit({ ...target, action: 'order.expired', metadata: { kind: order.kind } }, tx);
        } else {
          await audit(
            { ...target, action: 'order.cancelled', metadata: { kind: order.kind, by: 'system' } },
            tx,
          );
        }
        return 'closed';
      }
      case 'REFUNDED': {
        const ours = await tx.refund.findFirst({
          where: { paymentId: p.id, status: { in: ['REQUESTED', 'IN_PROCESS'] } },
        });
        if (ours) {
          await tx.refund.update({ where: { id: ours.id }, data: { status: 'APPROVED' } });
          await tx.order.update({
            where: { id: order.id },
            data: { status: 'REFUNDED', version: { increment: 1 } },
          });
          // Only an order that was counted (paidAt set) gives something back to the catalog.
          if (order.paidAt) await reverseCreditInTx(tx, order);
          await audit(
            {
              action: 'order.refund',
              actor: null,
              targetType: 'Order',
              targetId: order.id,
              metadata: {
                kind: order.kind,
                amountCents: ours.amountCents,
                reason: ours.reason,
                state: 'approved',
              },
            },
            tx,
          );
          return 'refunded';
        }
        return attention('REFUNDED_OUTSIDE');
      }
      case 'CHARGED_BACK':
      case 'IN_MEDIATION':
        if (
          (PAID_LIKE as readonly string[]).includes(order.status) ||
          order.status === 'REFUND_PENDING'
        ) {
          return attention('CHARGEBACK');
        }
        return 'unchanged';
      case 'PENDING':
      case 'IN_PROCESS':
        return 'unchanged';
    }
  });

  if (outcome !== 'unchanged' && outcome !== 'stale') {
    await publishOrderState(p.orderId);
    await flushOutbox(p.orderId);
  }
  if (outcome === 'late-approval' || outcome === 'attention') {
    logger.warn({ orderId: p.orderId, outcome }, 'order needs the streamer');
  }
  return outcome;
}

type PendingOrder = Prisma.OrderGetPayload<object>;

/**
 * An approved refund of a counted order: the movie is available again; the contribution leaves
 * the campaign (a "Meta atingida" campaign not yet scheduled re-opens). Watched or scheduled
 * items are left as they are.
 */
async function reverseCreditInTx(tx: Prisma.TransactionClient, order: PendingOrder) {
  if (order.kind === 'MOVIE') {
    await tx.catalogItem.updateMany({
      where: { id: order.itemId, status: 'SPONSORED' },
      data: { status: 'ACTIVE' },
    });
    return;
  }
  if (!order.campaignId) return;
  const c = await tx.campaign.findUniqueOrThrow({ where: { id: order.campaignId } });
  if (c.raisedCents < order.totalCents) return;
  if (c.status === 'SCHEDULED' || c.status === 'WATCHED') return;
  const reopen = c.status === 'FUNDED';
  await tx.campaign.update({
    where: { id: c.id },
    data: {
      raisedCents: { decrement: order.totalCents },
      remainingCents: { increment: order.totalCents },
      ...(c.supporterCount > 0 ? { supporterCount: { decrement: 1 } } : {}),
      ...(reopen ? { status: 'OPEN' as const, fundedAt: null } : {}),
      version: { increment: 1 },
    },
  });
  if (reopen) {
    await tx.catalogItem.updateMany({
      where: { id: order.itemId, status: 'FUNDED' },
      data: { status: 'ACTIVE' },
    });
  }
}

/** PENDING (or an accepted late approval) → PAID with every side effect (one transaction). */
export async function markPaidInTx(
  tx: Prisma.TransactionClient,
  order: PendingOrder,
  source: 'webhook' | 'reconcile' | 'order' | 'admin',
  now: Date,
): Promise<void> {
  await tx.order.update({
    where: { id: order.id },
    data: { status: 'PAID', paidAt: now, version: { increment: 1 } },
  });
  if (order.kind === 'MOVIE') {
    await tx.catalogItem.updateMany({
      where: { id: order.itemId, status: 'ACTIVE' },
      data: { status: 'SPONSORED', reservedUntil: null, reservedOrderId: null },
    });
  } else if (order.campaignId) {
    await creditContributionInTx(tx, order.campaignId, order.itemId, order.totalCents, true, now);
  }
  await consumeVoucher(tx, order.id);
  await confirmQueueJump(tx, order.id);
  await tx.emailOutbox.updateMany({
    where: { orderId: order.id, template: 'ORDER_RECEIPT', status: 'HELD' },
    data: { status: 'PENDING', nextAttemptAt: now },
  });
  await audit(
    {
      action: 'order.paid',
      actor: null,
      targetType: 'Order',
      targetId: order.id,
      metadata: { kind: order.kind, totalCents: order.totalCents, source },
    },
    tx,
  );
}

/**
 * Count a contribution: from reserved (normal path) or directly from remaining (an accepted late
 * approval). Reaching the goal completes the campaign ("Meta atingida").
 */
export async function creditContributionInTx(
  tx: Prisma.TransactionClient,
  campaignId: string,
  itemId: string,
  amountCents: number,
  fromReserved: boolean,
  now: Date,
): Promise<boolean> {
  const res = await tx.campaign.updateMany({
    where: fromReserved
      ? { id: campaignId, reservedCents: { gte: amountCents } }
      : { id: campaignId, status: 'OPEN', remainingCents: { gte: amountCents } },
    data: fromReserved
      ? {
          reservedCents: { decrement: amountCents },
          raisedCents: { increment: amountCents },
          supporterCount: { increment: 1 },
          version: { increment: 1 },
        }
      : {
          remainingCents: { decrement: amountCents },
          raisedCents: { increment: amountCents },
          supporterCount: { increment: 1 },
          version: { increment: 1 },
        },
  });
  if (res.count !== 1) return false;
  const c = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (c.status === 'OPEN' && c.raisedCents === c.goalCents) {
    await tx.campaign.update({
      where: { id: campaignId },
      data: { status: 'FUNDED', fundedAt: now, version: { increment: 1 } },
    });
    await tx.catalogItem.updateMany({
      where: { id: itemId, status: 'ACTIVE' },
      data: { status: 'FUNDED' },
    });
    await audit(
      {
        action: 'campaign.funded',
        actor: null,
        targetType: 'Campaign',
        targetId: campaignId,
        metadata: { goalCents: c.goalCents },
      },
      tx,
    );
    await queueFundedNotices(tx, campaignId);
  }
  return true;
}

/** Hand the order's ready e-mails to the worker (after commit). */
export async function flushOutbox(orderId: string): Promise<void> {
  const ready = await db().emailOutbox.findMany({
    where: { status: 'PENDING', OR: [{ orderId }, { template: 'CAMPAIGN_FUNDED' }] },
    select: { id: true },
    take: 500,
  });
  for (const r of ready) await enqueue.email(r.id);
}

/** payment.reconcile (05 §6 step 11): every 2 min for stale PENDING, nightly for the last 48 h. */
export async function reconcile(sweep: 'recent' | 'nightly', now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - (sweep === 'nightly' ? 48 * 3600_000 : 2 * 3600_000));
  const staleBefore = new Date(now.getTime() - 2 * 60_000);
  const rows = await db().payment.findMany({
    where: {
      providerOrderId: { not: null },
      createdAt: { gte: since },
      ...(sweep === 'recent'
        ? {
            status: { in: ['PENDING', 'IN_PROCESS'] },
            OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
          }
        : {}),
    },
    select: { providerOrderId: true },
    take: sweep === 'nightly' ? 2000 : 200,
    orderBy: { createdAt: 'asc' },
  });
  for (const r of rows) await enqueue.paymentSync(r.providerOrderId!, 'reconcile');
  return rows.length;
}
