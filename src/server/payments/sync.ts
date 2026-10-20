import 'server-only';
import type { AttentionReason, PaymentStatus } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';
import { MIN_CONTRIBUTION_CENTS } from '@/lib/catalog/pricing';
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
  // Money can still arrive after we (or the bank) gave up: surfaced as a late approval, never lost.
  REJECTED: ['APPROVED'],
  CANCELLED: ['APPROVED'],
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

/**
 * Another transition (expiry, buyer cancel, an accept) moved the order between our read and our
 * write: the transaction rolls back and the sync re-reads. Every order transition here is
 * conditional on the status AND version it was read with.
 */
class OrderChanged extends Error {
  constructor() {
    super('order changed concurrently');
    this.name = 'OrderChanged';
  }
}

export async function syncMpOrder(
  mpOrderId: string,
  source: 'webhook' | 'reconcile' | 'order' = 'reconcile',
  now = new Date(),
): Promise<SyncOutcome> {
  const mp = await getMpOrder(mpOrderId); // unavailable → throws → BullMQ retries
  for (let attempt = 0; ; attempt++) {
    try {
      return await applyMpOrder(mp, source, now);
    } catch (err) {
      if (err instanceof OrderChanged && attempt < 3) continue;
      throw err; // BullMQ retries the job
    }
  }
}

async function applyMpOrder(
  mp: MpOrder,
  source: 'webhook' | 'reconcile' | 'order',
  now: Date,
): Promise<SyncOutcome> {
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

    /** Move the order only from the exact state we read; otherwise roll back and re-read. */
    const moveOrder = async (data: Prisma.OrderUpdateManyMutationInput) => {
      const moved = await tx.order.updateMany({
        where: { id: order.id, status: order.status, version: order.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (moved.count !== 1) throw new OrderChanged();
    };

    const attention = async (reason: AttentionReason): Promise<SyncOutcome> => {
      await moveOrder({ status: 'NEEDS_ATTENTION', attentionReason: reason });
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
          const outcome = await attention(problem);
          if (order.status === 'PENDING_PAYMENT') await releaseHoldsInTx(tx, order);
          return outcome;
        }
        if (order.status === 'PENDING_PAYMENT') {
          await moveOrder({ status: 'PAID', paidAt: now });
          if (await markPaidInTx(tx, order, source, now)) return 'paid';
          // The room it held is gone (should not happen while it was pending): the streamer decides.
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'NEEDS_ATTENTION',
              attentionReason: 'LATE_APPROVAL',
              paidAt: null,
              version: { increment: 1 },
            },
          });
          // Movie: drop its remaining holds. Contribution: its reservation is what's missing, so
          // only the held receipt is cancelled (releasing the amount again would double-count).
          if (order.kind === 'MOVIE') await releaseHoldsInTx(tx, order);
          else {
            await tx.emailOutbox.updateMany({
              where: { orderId: order.id, template: 'ORDER_RECEIPT', status: 'HELD' },
              data: { status: 'CANCELLED', sealedToken: null },
            });
          }
          await audit(
            {
              action: 'order.attention',
              actor: null,
              targetType: 'Order',
              targetId: order.id,
              metadata: { kind: order.kind, reason: 'LATE_APPROVAL' },
            },
            tx,
          );
          return 'late-approval';
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
        await moveOrder({ status: expired ? 'EXPIRED' : 'CANCELLED', cancelledAt: now });
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
          await moveOrder({ status: 'REFUNDED' });
          await tx.refund.update({ where: { id: ours.id }, data: { status: 'APPROVED' } });
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

/**
 * The side effects of an approved pending order (the caller has already moved it to PAID, in
 * the same transaction): movie SPONSORED / contribution counted, voucher + slot final, receipt
 * released, audit. False = the reservation it held is gone — nothing was credited.
 */
async function markPaidInTx(
  tx: Prisma.TransactionClient,
  order: PendingOrder,
  source: 'webhook' | 'reconcile' | 'order',
  now: Date,
): Promise<boolean> {
  if (order.kind === 'MOVIE') {
    const took = await tx.catalogItem.updateMany({
      where: {
        id: order.itemId,
        status: 'ACTIVE',
        OR: [{ reservedOrderId: order.id }, { reservedOrderId: null }],
      },
      data: { status: 'SPONSORED', reservedUntil: null, reservedOrderId: null },
    });
    if (took.count !== 1) return false;
  } else if (order.campaignId) {
    const ok = await creditContributionInTx(
      tx,
      order.campaignId,
      order.itemId,
      order.totalCents,
      true,
      now,
    );
    if (!ok) return false;
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
  return true;
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
      : {
          // an accepted late contribution: the campaign must still be open and the amount must
          // close the goal exactly or leave ≥ R$ 5 (the checkout rule — never a stalled campaign)
          id: campaignId,
          status: 'OPEN',
          deadlineAt: { gt: now },
          OR: [
            { remainingCents: amountCents },
            { remainingCents: { gte: amountCents + MIN_CONTRIBUTION_CENTS } },
          ],
        },
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

/**
 * payment.reconcile (05 §6 step 11). Every 2 min: stale PENDING payments of the last 2 h, orders
 * waiting for a refund, and notifications that were stored but never processed (queue down, sync
 * out of retries). Nightly: everything of the last 48 h, plus approved payments of the last
 * 120 days (chargebacks and refunds made in Mercado Pago's panel surface within a day).
 */
export async function reconcile(sweep: 'recent' | 'nightly', now = new Date()): Promise<number> {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const HOUR = 3600_000;
  const stale = ago(2 * 60_000);
  const ids = new Set<string>();
  const add = (rows: { providerOrderId: string | null }[]) => {
    for (const r of rows) if (r.providerOrderId) ids.add(r.providerOrderId);
  };

  if (sweep === 'recent') {
    add(
      await db().payment.findMany({
        where: {
          providerOrderId: { not: null },
          createdAt: { gte: ago(2 * HOUR) },
          status: { in: ['PENDING', 'IN_PROCESS'] },
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: stale } }],
        },
        select: { providerOrderId: true },
        take: 200,
        orderBy: { createdAt: 'asc' },
      }),
    );
    add(
      await db().payment.findMany({
        where: {
          providerOrderId: { not: null },
          order: { status: 'REFUND_PENDING' },
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: stale } }],
        },
        select: { providerOrderId: true },
        take: 100,
      }),
    );
    // Stored notifications that never got processed: re-queue them (the row is the durable copy).
    const unprocessed = await db().webhookEvent.findMany({
      where: {
        provider: 'MERCADO_PAGO',
        topic: 'order',
        outcome: 'RECEIVED',
        receivedAt: { lt: ago(5 * 60_000), gte: ago(7 * 24 * HOUR) },
      },
      select: { resourceId: true, requestId: true },
      take: 200,
      orderBy: { receivedAt: 'asc' },
    });
    for (const e of unprocessed) await enqueue.paymentSync(e.resourceId, 'webhook', e.requestId);
    for (const id of ids) await enqueue.paymentSync(id, 'reconcile');
    return ids.size + unprocessed.length;
  }

  add(
    await db().payment.findMany({
      where: { providerOrderId: { not: null }, createdAt: { gte: ago(48 * HOUR) } },
      select: { providerOrderId: true },
      take: 2000,
      orderBy: { createdAt: 'asc' },
    }),
  );
  add(
    await db().payment.findMany({
      where: {
        providerOrderId: { not: null },
        status: { in: ['APPROVED', 'IN_MEDIATION'] },
        approvedAt: { gte: ago(120 * 24 * HOUR) },
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: ago(20 * HOUR) } }],
      },
      select: { providerOrderId: true },
      take: 2000,
      orderBy: { approvedAt: 'asc' },
    }),
  );
  for (const id of ids) await enqueue.paymentSync(id, 'reconcile');
  return ids.size;
}
