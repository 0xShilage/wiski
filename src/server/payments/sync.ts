import 'server-only';
import type { Order, Payment } from '@/generated/prisma/client';
import type { OrderStatus, PaymentStatus } from '@/generated/prisma/enums';
import { audit } from '../audit/audit';
import { campaignState } from '../catalog/campaigns';
import { confirmHolds, releaseHolds } from '../checkout/holds';
import { db } from '../db';
import { getEnv } from '../env';
import { logger } from '../log';
import { announcePaidOrder } from '../overlay/state';
import { publishCampaign, publishOrder } from '../realtime/events';
import { amountToCents, getPayment, mapStatus, type MpPayment } from './mercadopago/client';

/**
 * Payment sync — the only code that turns a Mercado Pago payment into order state (05 §6 steps
 * 8–10). The webhook body is never trusted: the payment is always re-fetched from the API and
 * checked against what we created (id, external_reference, amount, currency, method, collector,
 * live mode). Any mismatch → NEEDS_ATTENTION, never PAID. Transitions are idempotent and
 * monotonic: applied only when MP's date_last_updated is not older than what we have AND the
 * optimistic versions of the payment and order still match.
 */

export type SyncOutcome = 'applied' | 'unchanged' | 'stale' | 'mismatch' | 'foreign' | 'conflict';

/** Allowed provider transitions ("never backwards"). Same status again is a no-op. */
const NEXT: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: [
    'APPROVED',
    'AUTHORIZED',
    'IN_PROCESS',
    'REJECTED',
    'CANCELLED',
    'IN_MEDIATION',
    'REFUNDED',
    'CHARGED_BACK',
  ],
  AUTHORIZED: [
    'APPROVED',
    'IN_PROCESS',
    'REJECTED',
    'CANCELLED',
    'IN_MEDIATION',
    'REFUNDED',
    'CHARGED_BACK',
  ],
  IN_PROCESS: [
    'APPROVED',
    'AUTHORIZED',
    'REJECTED',
    'CANCELLED',
    'IN_MEDIATION',
    'REFUNDED',
    'CHARGED_BACK',
  ],
  APPROVED: ['REFUNDED', 'CHARGED_BACK', 'IN_MEDIATION'],
  IN_MEDIATION: ['APPROVED', 'REFUNDED', 'CHARGED_BACK'],
  REJECTED: ['APPROVED'], // a late approval is still recorded (→ NEEDS_ATTENTION)
  CANCELLED: ['APPROVED'],
  REFUNDED: [],
  CHARGED_BACK: [],
};

const PENDING_LIKE: readonly PaymentStatus[] = ['PENDING', 'AUTHORIZED', 'IN_PROCESS'];

type Row = Payment & { order: Order };

function expectedLiveMode(): boolean {
  const env = getEnv();
  // development may opt in to real payments for a one-off test (MP_ALLOW_LIVE_IN_DEV, env.ts)
  return env.NODE_ENV === 'production' || env.MP_ALLOW_LIVE_IN_DEV === '1';
}

/** 05 §6.8: every field we rely on must match what we created. Returns the first bad field. */
export function verifyPayment(row: Row, mp: MpPayment): string | null {
  const env = getEnv();
  if (String(mp.id) !== row.providerPaymentId) return 'id';
  if (mp.external_reference !== row.orderId) return 'external_reference';
  if (amountToCents(mp.transaction_amount) !== row.amountCents) return 'amount';
  if (mp.currency_id !== 'BRL') return 'currency';
  if (mp.payment_method_id !== 'pix') return 'payment_method';
  if (!env.MP_COLLECTOR_ID || String(mp.collector_id ?? '') !== env.MP_COLLECTOR_ID)
    return 'collector';
  if (mp.live_mode !== expectedLiveMode()) return 'live_mode';
  return null;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

type Plan = {
  paymentTo: PaymentStatus;
  orderTo: OrderStatus;
  reason:
    | 'approved'
    | 'late-approval'
    | 'hold-lost'
    | 'verification-failed'
    | 'unknown-status'
    | 'rejected'
    | 'cancelled'
    | 'refunded'
    | 'charged-back'
    | 'in-mediation'
    | 'update';
  action: 'confirm' | 'release' | 'none';
};

function plan(
  order: Order,
  from: PaymentStatus,
  to: PaymentStatus,
  approvedAt: Date,
  expiresAt: Date,
  graceMs: number,
): Plan {
  const pending = order.status === 'PENDING_PAYMENT';
  switch (to) {
    case 'APPROVED':
      // judged by when the payer paid (MP date_approved), not by when we heard about it
      if (pending && approvedAt.getTime() <= expiresAt.getTime() + graceMs) {
        return { paymentTo: to, orderTo: 'PAID', reason: 'approved', action: 'confirm' };
      }
      if (pending) {
        // approved after our reservation window: release what we held, a human decides
        return {
          paymentTo: to,
          orderTo: 'NEEDS_ATTENTION',
          reason: 'late-approval',
          action: 'release',
        };
      }
      if (order.status === 'EXPIRED' || order.status === 'CANCELLED') {
        return {
          paymentTo: to,
          orderTo: 'NEEDS_ATTENTION',
          reason: 'late-approval',
          action: 'none',
        };
      }
      return { paymentTo: to, orderTo: order.status, reason: 'update', action: 'none' }; // e.g. mediation resolved
    case 'REJECTED':
    case 'CANCELLED':
      return pending
        ? {
            paymentTo: to,
            orderTo: 'CANCELLED',
            reason: to === 'REJECTED' ? 'rejected' : 'cancelled',
            action: 'release',
          }
        : { paymentTo: to, orderTo: order.status, reason: 'update', action: 'none' };
    case 'REFUNDED':
    case 'CHARGED_BACK':
    case 'IN_MEDIATION': {
      const reason =
        to === 'REFUNDED' ? 'refunded' : to === 'CHARGED_BACK' ? 'charged-back' : 'in-mediation';
      // Money left (or may leave) after a sale: the streamer decides what happens to the slot.
      if (pending) return { paymentTo: to, orderTo: 'NEEDS_ATTENTION', reason, action: 'release' };
      if (order.status === 'REFUND_PENDING' && to === 'REFUNDED') {
        return { paymentTo: to, orderTo: 'REFUNDED', reason, action: 'none' };
      }
      return {
        paymentTo: to,
        orderTo: order.status === 'REFUNDED' ? 'REFUNDED' : 'NEEDS_ATTENTION',
        reason,
        action: 'none',
      };
    }
    case 'PENDING':
    case 'AUTHORIZED':
    case 'IN_PROCESS':
      void from;
      return { paymentTo: to, orderTo: order.status, reason: 'update', action: 'none' };
  }
}

/** Reservation grace after MP's expiry (04 §2: Pix expiry + grace = reservationTtlMinutes). */
export const EXPIRY_GRACE_MS = 4 * 60_000;

export async function syncPayment(
  providerPaymentId: string,
  now = new Date(),
): Promise<SyncOutcome> {
  let row = (await db().payment.findUnique({
    where: { providerPaymentId },
    include: { order: true },
  })) as Row | null;
  const mp = await getPayment(providerPaymentId);
  if (!row) {
    // Crash between creating the Pix and saving its id: re-attach by external_reference.
    const ref = mp.external_reference ?? '';
    if (!/^[0-9a-f-]{36}$/.test(ref)) return 'foreign';
    const orphan = (await db().payment.findFirst({
      where: { orderId: ref, providerPaymentId: null },
      include: { order: true },
    })) as Row | null;
    if (!orphan) return 'foreign';
    await db().payment.updateMany({
      where: { id: orphan.id, providerPaymentId: null },
      data: { providerPaymentId },
    });
    row = { ...orphan, providerPaymentId };
  }
  // A concurrent change (another sync, the expiry job, a claim or cancel) bumps a version and makes
  // the compare-and-set fail: re-read our rows and apply the same MP payment again.
  for (let attempt = 0; ; attempt++) {
    const outcome = await applyPayment(row, mp, now);
    if (outcome !== 'conflict' || attempt >= 2) return outcome;
    const fresh = (await db().payment.findUnique({
      where: { id: row.id },
      include: { order: true },
    })) as Row | null;
    if (!fresh) return 'conflict';
    row = fresh;
  }
}

/** Apply an already-fetched MP payment to our row (also used by the expiry job after a cancel). */
export async function applyPayment(
  row: Row,
  mp: MpPayment,
  now = new Date(),
): Promise<SyncOutcome> {
  const order = row.order;
  const mpUpdated = parseDate(mp.date_last_updated) ?? now;
  if (row.providerUpdatedAt && mpUpdated.getTime() < row.providerUpdatedAt.getTime()) {
    await db().payment.update({ where: { id: row.id }, data: { lastSyncedAt: now } });
    return 'stale';
  }

  const bad = verifyPayment(row, mp);
  const mapped = mapStatus(mp.status);
  let p: Plan;
  if (bad || !mapped) {
    if (order.status === 'NEEDS_ATTENTION') {
      await db().payment.update({ where: { id: row.id }, data: { lastSyncedAt: now } });
      return 'mismatch';
    }
    logger.error(
      {
        alert: 'payments',
        orderId: order.id,
        field: bad ?? 'status',
        mpStatus: bad ? undefined : mp.status,
      },
      'payment verification failed',
    );
    p = {
      paymentTo: row.status,
      orderTo: 'NEEDS_ATTENTION',
      reason: bad ? 'verification-failed' : 'unknown-status',
      action: order.status === 'PENDING_PAYMENT' ? 'release' : 'none',
    };
  } else {
    if (mapped === row.status) {
      await db().payment.update({
        where: { id: row.id },
        data: {
          lastSyncedAt: now,
          providerUpdatedAt: mpUpdated,
          statusDetail: mp.status_detail ?? null,
        },
      });
      return 'unchanged';
    }
    if (!NEXT[row.status].includes(mapped)) {
      await db().payment.update({ where: { id: row.id }, data: { lastSyncedAt: now } });
      return 'stale';
    }
    p = plan(
      order,
      row.status,
      mapped,
      parseDate(mp.date_approved) ?? now,
      row.expiresAt,
      EXPIRY_GRACE_MS,
    );
  }

  let funded = false;
  const result = await db()
    .$transaction(
      async (t) => {
        const payRes = await t.payment.updateMany({
          where: { id: row.id, version: row.version },
          data: {
            status: p.paymentTo,
            statusDetail: bad ? `verification_failed:${bad}` : (mp.status_detail ?? null),
            providerUpdatedAt: mpUpdated,
            lastSyncedAt: now,
            version: { increment: 1 },
            ...(p.paymentTo === 'APPROVED' && !row.approvedAt
              ? { approvedAt: parseDate(mp.date_approved) ?? now }
              : {}),
          },
        });
        if (payRes.count !== 1) return 'conflict' as const;

        let orderTo = p.orderTo;
        let reason = p.reason;
        if (p.action === 'confirm') {
          const c = await confirmHolds(t, order, now);
          if (!c.ok) {
            orderTo = 'NEEDS_ATTENTION';
            reason = 'hold-lost';
            await releaseHolds(t, order, { extrasOnly: true });
          } else funded = c.funded;
        } else if (p.action === 'release') {
          await releaseHolds(t, order);
        }

        if (orderTo !== order.status) {
          const ordRes = await t.order.updateMany({
            where: { id: order.id, version: order.version },
            data: {
              status: orderTo,
              version: { increment: 1 },
              ...(orderTo !== 'PENDING_PAYMENT' ? { ipKey: null } : {}),
              ...(orderTo === 'PAID' ? { paidAt: now } : {}),
              ...(orderTo === 'CANCELLED' ? { cancelledAt: now } : {}),
            },
          });
          if (ordRes.count !== 1) throw new SyncConflict();
        }
        await audit(
          {
            action: 'payment.status',
            actor: null,
            targetType: 'Order',
            targetId: order.id,
            metadata: {
              from: row.status,
              to: p.paymentTo,
              orderFrom: order.status,
              orderTo,
              reason,
              ...(funded ? { funded } : {}),
            },
          },
          t,
        );
        return { orderTo };
      },
      { isolationLevel: 'ReadCommitted', timeout: 10_000 },
    )
    .catch((err: unknown) => {
      if (err instanceof SyncConflict) return 'conflict' as const;
      throw err;
    });

  if (result === 'conflict') return 'conflict';
  await announce(order, result.orderTo, now);
  return bad || !mapped ? 'mismatch' : 'applied';
}

class SyncConflict extends Error {}

/** After commit: tell the order page and the campaign bar. */
export async function announce(
  order: Pick<Order, 'id' | 'publicCode' | 'campaignId'>,
  status: OrderStatus,
  now: Date,
) {
  await publishOrder(order.id, {
    type: 'status',
    code: order.publicCode,
    status,
    at: now.toISOString(),
  });
  if (status === 'PAID') await announcePaidOrder(order.id); // "Novo patrocínio" on stream
  if (order.campaignId) {
    const c = await db().campaign.findUnique({ where: { id: order.campaignId } });
    if (c) {
      await publishCampaign(c.id, {
        type: 'progress',
        raisedCents: c.raisedCents,
        remainingCents: c.remainingCents,
        supporterCount: c.supporterCount,
        state: campaignState(c, now),
        at: now.toISOString(),
      });
    }
  }
}

export { PENDING_LIKE };
