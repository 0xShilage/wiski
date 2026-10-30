import 'server-only';
import type { Order, Payment } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { releaseHolds } from '../checkout/holds';
import { db } from '../db';
import { logger } from '../log';
import { cancelPayment, MpError } from './mercadopago/client';
import { announce, EXPIRY_GRACE_MS, syncPayment, type SyncOutcome } from './sync';

/**
 * Worker jobs (01 §3.3, 05 §6.11), all idempotent and safe to run on more than one process:
 *  • webhook events — the verified WebhookEvent rows are the durable queue; a row is claimed with
 *    a 60 s lease, synced, and marked PROCESSED/IGNORED, or retried with backoff;
 *  • reconciliation — every 2 min, pending payments not synced for 2 min are re-fetched, so a lost
 *    or rejected webhook delays a status change by ≤ 2 min but can never lose it;
 *  • expiry — unpaid orders past the Pix expiry + grace are cancelled at Mercado Pago and their
 *    movie / campaign amount / voucher / queue slot released;
 *  • nightly sweep — everything touched in the last 48 h is re-synced (refunds, chargebacks).
 */
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 8;
const STALE_MS = 2 * 60_000;
/** Orders whose Pix was never created (crash/timeout at checkout) are released after this. */
const ORPHAN_MS = 5 * 60_000;

function backoffMs(attempt: number): number {
  return Math.min(30 * 60_000, 15_000 * 2 ** (attempt - 1));
}

export async function processWebhookEvents(now = new Date(), limit = 20): Promise<number> {
  const due = await db().webhookEvent.findMany({
    where: {
      outcome: 'RECEIVED',
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  });
  let done = 0;
  const seen = new Set<string>();
  for (const ev of due) {
    const claim = await db().webhookEvent.updateMany({
      where: {
        id: ev.id,
        outcome: 'RECEIVED',
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (claim.count !== 1) continue;
    try {
      // Bursts for one payment coalesce: one fetch per resource per run.
      const outcome: SyncOutcome | 'coalesced' = seen.has(ev.resourceId)
        ? 'coalesced'
        : await syncPayment(ev.resourceId, now);
      // still racing after the retries: keep the event and try again with backoff
      if (outcome === 'conflict') throw new Error('sync conflict');
      seen.add(ev.resourceId);
      await db().webhookEvent.update({
        where: { id: ev.id },
        data: {
          outcome: outcome === 'foreign' ? 'IGNORED' : 'PROCESSED',
          processedAt: new Date(),
          lockedUntil: null,
        },
      });
      done++;
    } catch (err) {
      const attempts = ev.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      logger.warn(
        {
          job: 'webhook',
          eventId: ev.id,
          attempts,
          err: err instanceof MpError ? err.message : err instanceof Error ? err.name : 'unknown',
        },
        final ? 'webhook event failed (reconciliation takes over)' : 'webhook event retry',
      );
      await db().webhookEvent.update({
        where: { id: ev.id },
        data: {
          lockedUntil: null,
          nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
          ...(final ? { outcome: 'FAILED', processedAt: new Date() } : {}),
        },
      });
    }
  }
  return done;
}

async function safeSync(id: string, now: Date, job: string): Promise<SyncOutcome | 'error'> {
  try {
    return await syncPayment(id, now);
  } catch (err) {
    logger.warn(
      {
        job,
        err: err instanceof MpError ? err.message : err instanceof Error ? err.name : 'unknown',
      },
      'payment sync failed',
    );
    return 'error';
  }
}

/** Pending payments not synced in the last 2 min (05 §6.11). */
export async function reconcilePending(now = new Date(), limit = 50): Promise<number> {
  const rows = await db().payment.findMany({
    where: {
      providerPaymentId: { not: null },
      status: { in: ['PENDING', 'AUTHORIZED', 'IN_PROCESS', 'IN_MEDIATION'] },
      createdAt: { gt: new Date(now.getTime() - 48 * 3_600_000) },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now.getTime() - STALE_MS) } }],
    },
    orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
    select: { providerPaymentId: true },
  });
  for (const r of rows) await safeSync(r.providerPaymentId!, now, 'reconcile');
  return rows.length;
}

/** Nightly: re-sync everything created in the last 48 h, whatever its status. */
export async function sweepRecent(now = new Date()): Promise<number> {
  const rows = await db().payment.findMany({
    where: {
      providerPaymentId: { not: null },
      createdAt: { gt: new Date(now.getTime() - 48 * 3_600_000) },
    },
    select: { providerPaymentId: true },
  });
  for (const r of rows) await safeSync(r.providerPaymentId!, now, 'sweep');
  return rows.length;
}

type Expirable = Order & { payment: Payment | null };

/** Unpaid orders past the Pix expiry + grace (or whose Pix was never created). */
export async function expireOrders(now = new Date(), limit = 50): Promise<number> {
  const due = (await db().order.findMany({
    where: {
      status: 'PENDING_PAYMENT',
      OR: [
        { payment: { expiresAt: { lt: new Date(now.getTime() - EXPIRY_GRACE_MS) } } },
        {
          payment: { providerPaymentId: null },
          createdAt: { lt: new Date(now.getTime() - ORPHAN_MS) },
        },
        { payment: null, createdAt: { lt: new Date(now.getTime() - ORPHAN_MS) } },
      ],
    },
    include: { payment: true },
    take: limit,
  })) as Expirable[];
  let expired = 0;
  for (const o of due) {
    if (await expireOne(o, now)) expired++;
  }
  return expired;
}

async function expireOne(o: Expirable, now: Date): Promise<boolean> {
  let cancelledAtMp = false;
  const pid = o.payment?.providerPaymentId;
  if (pid) {
    // Last look first: an approval that arrived in the meantime wins over expiry.
    const outcome = await safeSync(pid, now, 'expire');
    const fresh = await db().order.findUnique({ where: { id: o.id }, include: { payment: true } });
    if (!fresh || fresh.status !== 'PENDING_PAYMENT') return false;
    o = fresh;
    // MP unreachable: expire anyway — the Pix itself can't be paid after its date_of_expiration,
    // and keeping the hold would block the movie (one active order per movie) indefinitely.
    if (outcome !== 'error')
      try {
        const res = await cancelPayment(pid);
        cancelledAtMp = res.status === 'cancelled';
      } catch (err) {
        // Not fatal: an unpaid Pix dies at its own date_of_expiration anyway.
        logger.warn(
          { job: 'expire', orderId: o.id, err: err instanceof Error ? err.message : 'unknown' },
          'mercadopago cancel failed',
        );
      }
  }
  const ok = await db().$transaction(
    async (t) => {
      const res = await t.order.updateMany({
        where: { id: o.id, version: o.version, status: 'PENDING_PAYMENT' },
        data: { status: 'EXPIRED', ipKey: null, cancelledAt: now, version: { increment: 1 } },
      });
      if (res.count !== 1) return false;
      await releaseHolds(t, o);
      if (o.payment && cancelledAtMp) {
        await t.payment.updateMany({
          where: { id: o.payment.id, status: { in: ['PENDING', 'AUTHORIZED', 'IN_PROCESS'] } },
          data: { status: 'CANCELLED', lastSyncedAt: now, version: { increment: 1 } },
        });
      }
      await audit(
        {
          action: 'order.expire',
          actor: null,
          targetType: 'Order',
          targetId: o.id,
          metadata: { kind: o.kind },
        },
        t,
      );
      return true;
    },
    { isolationLevel: 'ReadCommitted', timeout: 10_000 },
  );
  if (ok) await announce(o, 'EXPIRED', now);
  return ok;
}

/** 02 §5: webhook events are kept 90 days. */
export async function purgeWebhookEvents(now = new Date()): Promise<number> {
  const res = await db().webhookEvent.deleteMany({
    where: {
      receivedAt: { lt: new Date(now.getTime() - 90 * 86_400_000) },
      outcome: { not: 'RECEIVED' },
    },
  });
  return res.count;
}
