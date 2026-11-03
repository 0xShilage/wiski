/**
 * Mercado Pago webhook + worker (05 §6 test list): signature checks (bad signature, wrong secret,
 * truncated v1, missing headers, uppercase id, stale/future ts, previous secret), replay and
 * duplicate deliveries, unknown topics, foreign payment ids, out-of-order updates, amount and
 * collector mismatches, late approval after expiry, MP outages with retry/backoff, reconciliation
 * of a missed webhook, expiry with release of every hold, refunds and chargebacks after a sale.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as webhook } from '@/app/api/webhooks/mercadopago/route';
import { db } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { signForTest } from '@/server/payments/mercadopago/signature';
import {
  expireOrders,
  processWebhookEvents,
  purgeWebhookEvents,
  reconcilePending,
  reconcileEveryMs,
} from '@/server/payments/jobs';
import { syncPayment } from '@/server/payments/sync';
import { clearCatalog } from '../support/catalog';
import {
  contribute,
  contributionBody,
  type Legal,
  liveMovie,
  movieBody,
  openCampaignFor,
  orderByCode,
  sponsor,
} from '../support/checkout';
import { call, freshIp, req } from '../support/http';
import { ensureLegal, FAKE_SIGNING_KEY, type FakeMp, installFakeMp } from '../support/mercadopago';

let legal: Legal;
let mp: FakeMp;

beforeAll(async () => {
  legal = await ensureLegal();
});
beforeEach(async () => {
  mp = installFakeMp();
  await clearCatalog();
});

function deliver(
  dataId: string,
  o: {
    secret?: string;
    requestId?: string | null;
    ts?: string;
    type?: string;
    signature?: string | null;
    signedId?: string;
  } = {},
) {
  const requestId = o.requestId === undefined ? randomUUID() : o.requestId;
  const ts = o.ts ?? String(Date.now());
  const signature =
    o.signature !== undefined
      ? o.signature
      : signForTest(o.secret ?? FAKE_SIGNING_KEY, o.signedId ?? dataId, requestId ?? '', ts);
  const headers: Record<string, string | null> = {
    'x-signature': signature,
    'x-request-id': requestId,
    origin: null,
    'sec-fetch-site': null,
  };
  return call(
    webhook,
    req(
      'POST',
      `/api/webhooks/mercadopago?data.id=${encodeURIComponent(dataId)}&type=${o.type ?? 'payment'}`,
      {
        body: {
          action: 'payment.updated',
          type: o.type ?? 'payment',
          data: { id: dataId },
          extra: { new: 'field' },
        },
        headers,
        ip: freshIp(),
      },
    ),
  );
}

async function pendingMovieOrder(runtime = 115) {
  const movie = await liveMovie(runtime);
  const r = await sponsor(movieBody(movie.id, legal));
  expect(r.res.status).toBe(201);
  const o = await orderByCode(r.json.publicCode as string);
  return { order: o, movie, pid: o.payment!.providerPaymentId! };
}

describe('signature (05 §6 steps 2–5)', () => {
  it('accepts a valid delivery, stores it, and the worker applies the payment', async () => {
    const { order, pid } = await pendingMovieOrder();
    mp.approve(Number(pid));
    const res = await deliver(pid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'RECEIVED' });
    const ev = await db().webhookEvent.findFirstOrThrow({ where: { resourceId: pid } });
    expect(ev).toMatchObject({ outcome: 'RECEIVED', topic: 'payment', provider: 'MERCADO_PAGO' });
    expect(await processWebhookEvents()).toBe(1);
    expect((await orderByCode(order.publicCode)).status).toBe('PAID');
    expect((await db().webhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).outcome).toBe(
      'PROCESSED',
    );
  });

  it.each([
    ['wrong secret', { secret: 'another-secret-another-secret-0000' }],
    ['no signature', { signature: null }],
    ['garbage', { signature: 'nonsense' }],
    ['truncated v1', { signature: 'ts=1700000000000,v1=abcd' }],
    ['duplicated ts', { signature: `ts=1,ts=2,v1=${'a'.repeat(64)}` }],
    ['missing x-request-id', { requestId: null }],
    ['signed for another id', { signedId: '999' }],
    ['stale ts (11 min)', { ts: String(Date.now() - 11 * 60_000) }],
    ['future ts (11 min)', { ts: String(Date.now() + 11 * 60_000) }],
  ])('rejects %s with 401 and stores nothing', async (_name, o) => {
    const res = await deliver('123456', o);
    expect(res.status).toBe(401);
    expect(await db().webhookEvent.count({ where: { resourceId: '123456' } })).toBe(0);
  });

  it('accepts ts in seconds as well as milliseconds', async () => {
    const res = await deliver('424242', { ts: String(Math.floor(Date.now() / 1000)) });
    expect(res.status).toBe(200);
  });

  it('lower-cases an alphanumeric id in the manifest (MP rule)', async () => {
    // signed over "abc123", delivered as "ABC123" → still valid, then ignored (not a payment id)
    const ts = String(Date.now());
    const rid = randomUUID();
    const res = await deliver('ABC123', {
      signature: signForTest(FAKE_SIGNING_KEY, 'abc123', rid, ts),
      requestId: rid,
      ts,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'IGNORED' });
  });

  it('accepts the previous secret during rotation', async () => {
    vi.stubEnv('MP_WEBHOOK_SECRET', 'brand-new-secret-brand-new-secret-00');
    vi.stubEnv('MP_WEBHOOK_SECRET_PREVIOUS', FAKE_SIGNING_KEY);
    resetEnvCache();
    expect((await deliver('777777')).status).toBe(200);
  });

  it('refuses everything while no secret is configured', async () => {
    vi.stubEnv('MP_WEBHOOK_SECRET', '');
    resetEnvCache();
    expect((await deliver('888888')).status).toBe(401);
  });
});

describe('replay, duplicates, topics', () => {
  it('the same x-request-id twice → 200 DUPLICATE (MP must stop retrying)', async () => {
    const rid = randomUUID();
    expect(await (await deliver('5550001', { requestId: rid })).json()).toEqual({
      status: 'RECEIVED',
    });
    expect(await (await deliver('5550001', { requestId: rid })).json()).toEqual({
      status: 'DUPLICATE',
    });
    expect(await db().webhookEvent.count({ where: { requestId: rid } })).toBe(1);
  });

  it('10 parallel copies of one delivery → one row', async () => {
    const rid = randomUUID();
    const ts = String(Date.now());
    const results = await Promise.all(
      Array.from({ length: 10 }, () => deliver('5550002', { requestId: rid, ts })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await db().webhookEvent.count({ where: { requestId: rid } })).toBe(1);
  });

  it('bursts for one payment coalesce into one Mercado Pago fetch', async () => {
    const { order, pid } = await pendingMovieOrder();
    mp.approve(Number(pid));
    for (let i = 0; i < 5; i++) await deliver(pid);
    const gets = () => mp.calls.filter((c) => c.method === 'GET').length;
    const before = gets();
    await processWebhookEvents();
    expect(gets() - before).toBe(1);
    expect((await orderByCode(order.publicCode)).status).toBe('PAID');
    expect(
      await db().webhookEvent.count({ where: { resourceId: pid, outcome: 'PROCESSED' } }),
    ).toBe(5);
  });

  it('ignores other topics and malformed ids (still 200)', async () => {
    expect(await (await deliver('5550003', { type: 'merchant_order' })).json()).toEqual({
      status: 'IGNORED',
    });
    expect(await (await deliver('12a', {})).json()).toEqual({ status: 'IGNORED' });
  });

  it('a signed notification for a payment that is not ours is ignored by the worker', async () => {
    mp.payments.set(31337, {
      id: 31337,
      status: 'approved',
      status_detail: 'accredited',
      transaction_amount: 20,
      currency_id: 'BRL',
      payment_method_id: 'pix',
      external_reference: 'someone-else',
      collector_id: 3733347216,
      live_mode: false,
      date_created: new Date().toISOString(),
      date_approved: new Date().toISOString(),
      date_last_updated: new Date().toISOString(),
      date_of_expiration: new Date().toISOString(),
      point_of_interaction: { transaction_data: { qr_code: '', qr_code_base64: '' } },
    });
    await deliver('31337');
    await processWebhookEvents();
    expect(
      (await db().webhookEvent.findFirstOrThrow({ where: { resourceId: '31337' } })).outcome,
    ).toBe('IGNORED');
  });
});

describe('sync rules (05 §6 steps 8–9)', () => {
  it('out-of-order: an older "pending" after "approved" never regresses the order', async () => {
    const { order, pid } = await pendingMovieOrder();
    const t1 = new Date(Date.now() + 1000);
    mp.approve(Number(pid), t1);
    await syncPayment(pid);
    mp.set(Number(pid), { status: 'pending', date_approved: null }, new Date(t1.getTime() - 500));
    expect(await syncPayment(pid)).toBe('stale');
    expect((await orderByCode(order.publicCode)).status).toBe('PAID');
  });

  it('amount mismatch → NEEDS_ATTENTION, never PAID, movie released', async () => {
    const { order, pid, movie } = await pendingMovieOrder();
    mp.approve(Number(pid));
    mp.set(Number(pid), { transaction_amount: 0.2 });
    expect(await syncPayment(pid)).toBe('mismatch');
    const o = await orderByCode(order.publicCode);
    expect(o.status).toBe('NEEDS_ATTENTION');
    expect(o.payment!.statusDetail).toBe('verification_failed:amount');
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).status).toBe(
      'ACTIVE',
    );
  });

  it.each([
    ['collector', { collector_id: 1 }],
    ['live mode', { live_mode: true }],
    ['method', { payment_method_id: 'visa' }],
    ['currency', { currency_id: 'USD' }],
    ['external reference', { external_reference: randomUUID() }],
  ])('%s mismatch → NEEDS_ATTENTION', async (_n, patch) => {
    const { order, pid } = await pendingMovieOrder();
    mp.approve(Number(pid));
    mp.set(Number(pid), patch as never);
    await syncPayment(pid);
    expect((await orderByCode(order.publicCode)).status).toBe('NEEDS_ATTENTION');
  });

  it('an unknown MP status → NEEDS_ATTENTION', async () => {
    const { order, pid } = await pendingMovieOrder();
    mp.set(Number(pid), { status: 'something_new' });
    expect(await syncPayment(pid)).toBe('mismatch');
    expect((await orderByCode(order.publicCode)).status).toBe('NEEDS_ATTENTION');
  });

  it('rejected → CANCELLED and every hold released', async () => {
    const { order, pid, movie } = await pendingMovieOrder();
    mp.set(Number(pid), { status: 'rejected' });
    await syncPayment(pid);
    expect((await orderByCode(order.publicCode)).status).toBe('CANCELLED');
    expect(
      (await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).reservedOrderId,
    ).toBeNull();
  });

  it('late approval (paid after expiry + grace) → NEEDS_ATTENTION, movie not sold', async () => {
    const { order, pid, movie } = await pendingMovieOrder();
    const late = new Date(order.payment!.expiresAt.getTime() + 5 * 60_000);
    mp.approve(Number(pid), late);
    await syncPayment(pid, late);
    expect((await orderByCode(order.publicCode)).status).toBe('NEEDS_ATTENTION');
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).status).toBe(
      'ACTIVE',
    );
  });

  it('approval within the grace window still sells', async () => {
    const { order, pid } = await pendingMovieOrder();
    const at = new Date(order.payment!.expiresAt.getTime() + 2 * 60_000);
    mp.approve(Number(pid), at);
    await syncPayment(pid, at);
    expect((await orderByCode(order.publicCode)).status).toBe('PAID');
  });

  it('approval after the order already EXPIRED → NEEDS_ATTENTION', async () => {
    const { order, pid } = await pendingMovieOrder();
    const later = new Date(order.payment!.expiresAt.getTime() + 10 * 60_000);
    mp.failCancel = { status: 500, times: 1 };
    expect(await expireOrders(later)).toBe(1);
    expect((await orderByCode(order.publicCode)).status).toBe('EXPIRED');
    mp.approve(Number(pid), new Date(order.payment!.expiresAt.getTime() - 60_000));
    await syncPayment(pid, later);
    expect((await orderByCode(order.publicCode)).status).toBe('NEEDS_ATTENTION');
  });

  it.each([['refunded'], ['charged_back'], ['in_mediation']])(
    'after a sale, %s → NEEDS_ATTENTION (streamer decides; movie stays sponsored)',
    async (status) => {
      const { order, pid, movie } = await pendingMovieOrder();
      mp.approve(Number(pid));
      await syncPayment(pid);
      mp.set(Number(pid), { status }, new Date(Date.now() + 1000));
      await syncPayment(pid);
      const o = await orderByCode(order.publicCode);
      expect(o.status).toBe('NEEDS_ATTENTION');
      expect(o.payment!.status).toBe(status.toUpperCase());
      expect((await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).status).toBe(
        'SPONSORED',
      );
    },
  );
});

describe('worker resilience', () => {
  it('parallel syncs of one approval apply it exactly once (compare-and-set + retry)', async () => {
    const { order, pid } = await pendingMovieOrder();
    mp.approve(Number(pid));
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => syncPayment(pid)));
    expect(outcomes.filter((o) => o === 'applied')).toHaveLength(1);
    expect(outcomes.every((o) => ['applied', 'unchanged'].includes(o))).toBe(true);
    expect((await orderByCode(order.publicCode)).status).toBe('PAID');
    expect(
      await db().auditLog.count({ where: { targetId: order.id, action: 'payment.status' } }),
    ).toBe(1);
  });

  it('MP 5xx while processing → retried with backoff, then applied', async () => {
    const { order, pid } = await pendingMovieOrder();
    mp.approve(Number(pid));
    await deliver(pid);
    mp.failGet = { status: 503, times: 1 };
    const now = new Date();
    expect(await processWebhookEvents(now)).toBe(0);
    const ev = await db().webhookEvent.findFirstOrThrow({ where: { resourceId: pid } });
    expect(ev).toMatchObject({ outcome: 'RECEIVED', attempts: 1, lockedUntil: null });
    expect(ev.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    expect(await processWebhookEvents(now)).toBe(0); // not due yet
    expect(await processWebhookEvents(new Date(now.getTime() + 60_000))).toBe(1);
    expect((await orderByCode(order.publicCode)).status).toBe('PAID');
  });

  it('gives up after 8 attempts (reconciliation takes over)', async () => {
    const { pid } = await pendingMovieOrder();
    await deliver(pid);
    mp.failGet = { status: 500, times: 100 };
    let t = Date.now();
    for (let i = 0; i < 8; i++) {
      await processWebhookEvents(new Date(t));
      t += 60 * 60_000;
    }
    expect((await db().webhookEvent.findFirstOrThrow({ where: { resourceId: pid } })).outcome).toBe(
      'FAILED',
    );
  });

  it('reconciliation finds an approval whose webhook never came', async () => {
    const { order, pid } = await pendingMovieOrder();
    mp.approve(Number(pid));
    await reconcilePending(new Date(Date.now() + 3 * 60_000));
    expect((await orderByCode(order.publicCode)).status).toBe('PAID');
  });

  it('purges processed webhook events after 90 days', async () => {
    await deliver('9990001');
    await db().webhookEvent.updateMany({
      where: { resourceId: '9990001' },
      data: { outcome: 'IGNORED' },
    });
    expect(await purgeWebhookEvents(new Date(Date.now() + 91 * 86_400_000))).toBeGreaterThanOrEqual(
      1,
    );
  });
});

describe('expiry (05 §6.11)', () => {
  it('releases the movie, the voucher and the queue slot, and cancels the Pix at MP', async () => {
    const v = await db().voucher.create({
      data: {
        code: `EXPIRA-${randomUUID().slice(0, 6).toUpperCase()}`,
        kind: 'PERCENT',
        percentBps: 1000,
      },
    });
    await db().queueJumpSlot.deleteMany({});
    const movie = await liveMovie(100);
    const r = await sponsor(
      movieBody(movie.id, legal, {
        voucherCode: v.code,
        queueJumpTier: 'prioridade',
        expectedTotalCents: 3400,
      }),
    );
    expect(r.res.status).toBe(201);
    const o = await orderByCode(r.json.publicCode as string);
    expect(await expireOrders(new Date())).toBe(0); // not yet
    const later = new Date(o.payment!.expiresAt.getTime() + 5 * 60_000);
    expect(await expireOrders(later)).toBe(1);
    const e = await orderByCode(o.publicCode);
    expect(e).toMatchObject({ status: 'EXPIRED', ipKey: null });
    expect(e.payment!.status).toBe('CANCELLED');
    expect(e.voucherRedemption!.status).toBe('RELEASED');
    expect(e.queueJumpSlot).toBeNull();
    expect((await db().voucher.findUniqueOrThrow({ where: { id: v.id } })).redemptionCount).toBe(0);
    expect(
      (await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).reservedOrderId,
    ).toBeNull();
    expect(mp.calls.some((c) => c.method === 'PUT')).toBe(true);
    // the movie can be bought again
    expect((await sponsor(movieBody(movie.id, legal))).res.status).toBe(201);
  });

  it('an approval that arrived just before expiry wins', async () => {
    const { order, pid } = await pendingMovieOrder();
    mp.approve(Number(pid), new Date(order.payment!.expiresAt.getTime() - 60_000));
    await expireOrders(new Date(order.payment!.expiresAt.getTime() + 5 * 60_000));
    expect((await orderByCode(order.publicCode)).status).toBe('PAID');
  });

  it('expires even when Mercado Pago is unreachable (the Pix dies at its own expiry)', async () => {
    const { order } = await pendingMovieOrder();
    mp.failGet = { status: 503, times: 10 };
    mp.failCancel = { status: 503, times: 10 };
    expect(await expireOrders(new Date(order.payment!.expiresAt.getTime() + 5 * 60_000))).toBe(1);
    expect((await orderByCode(order.publicCode)).status).toBe('EXPIRED');
  });

  it('gives an expired contribution back to the campaign', async () => {
    const { campaign } = await openCampaignFor(10_000);
    const r = await contribute(campaign.id, contributionBody(2500, legal));
    const o = await orderByCode(r.json.publicCode as string);
    expect(
      (await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).reservedCents,
    ).toBe(2500);
    await expireOrders(new Date(o.payment!.expiresAt.getTime() + 5 * 60_000));
    expect(await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({
      reservedCents: 0,
      remainingCents: 10_000,
      raisedCents: 0,
    });
  });
});

describe('reconciliation pace (2026-11-03)', () => {
  it('runs every 15 s', () => {
    expect(reconcileEveryMs()).toBe(15_000);
  });

  it('re-reads a payable Pix after 15 s; an old open payment only after 2 min', async () => {
    const { order, pid } = await pendingMovieOrder();
    const synced = new Date();
    await db().payment.updateMany({ where: { orderId: order.id }, data: { lastSyncedAt: synced } });
    const at = (ms: number) => new Date(synced.getTime() + ms);
    expect(await reconcilePending(at(10_000))).toBe(0);
    mp.approve(Number(pid));
    expect(await reconcilePending(at(16_000))).toBe(1);
    expect((await orderByCode(order.publicCode)).status).toBe('PAID');

    const late = await pendingMovieOrder();
    const old = new Date(Date.now() - 40 * 60_000);
    await db().payment.updateMany({
      where: { orderId: late.order.id },
      data: { createdAt: old, lastSyncedAt: new Date() },
    });
    expect(await reconcilePending(new Date(Date.now() + 30_000))).toBe(0);
    expect(await reconcilePending(new Date(Date.now() + 3 * 60_000))).toBe(1);
  });
});
