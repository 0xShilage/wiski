/**
 * /admin/pedidos actions (13 §3 step 13): moderation of the public texts, accepting a late
 * approval (D4) while there is room, and the exception refund — idempotent under a double-click,
 * reversing the sponsorship/contribution, every step audited. Real routes, Mercado Pago mocked.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as contributions from '@/app/api/v1/campaigns/[id]/contributions/route';
import * as orders from '@/app/api/v1/orders/route';
import * as list from '@/app/api/v1/admin/orders/route';
import * as detail from '@/app/api/v1/admin/orders/[code]/route';
import * as moderate from '@/app/api/v1/admin/orders/[code]/moderate/route';
import * as refund from '@/app/api/v1/admin/orders/[code]/refund/route';
import * as resolve from '@/app/api/v1/admin/orders/[code]/resolve/route';
import { db } from '@/server/db';
import { paymentsQueue } from '@/server/jobs/queues';
import { cancelPixAtProvider, expireDueOrders } from '@/server/orders/lifecycle';
import { syncMpOrder } from '@/server/payments/sync';
import { clearCatalog, makeCampaign, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { call, freshIp, req, signedIn } from '../support/http';
import { checkoutHeaders, installPaymentsMock, LEGAL } from '../support/payments';

const mock = installPaymentsMock();

beforeEach(async () => {
  await clearCatalog();
  await paymentsQueue().obliterate({ force: true });
});

async function staff(role: 'MODERATOR' | 'STREAMER') {
  const u = await makeUser({ role });
  const s = await signedIn(u); // fresh login (step-up) + fresh passkey
  return { user: u, ...s };
}

async function buyMovie(extra: Record<string, unknown> = {}, slot = 1) {
  const movie = await makeItem({ status: 'ACTIVE', slot, runtimeMinutes: 115 });
  const res = await call(
    orders.POST,
    req('POST', '/api/v1/orders', {
      body: {
        itemId: movie.id,
        expectedTotalCents: 2000,
        contactEmail: `b-${randomUUID().slice(0, 8)}@example.com`,
        legal: LEGAL,
        ...extra,
      },
      headers: checkoutHeaders(),
      ip: freshIp(),
    }),
  );
  expect(res.status).toBe(201);
  const { order } = (await res.json()) as { order: { id: string; publicCode: string } };
  return { movie, orderId: order.id, code: order.publicCode, mpId: mock.orderFor(order.id)!.id };
}

async function contribute(campaignId: string, amountCents: number) {
  const res = await call(
    contributions.POST,
    req('POST', `/api/v1/campaigns/${campaignId}/contributions`, {
      body: {
        amountCents,
        contactEmail: `f-${randomUUID().slice(0, 8)}@example.com`,
        legal: LEGAL,
      },
      headers: checkoutHeaders(),
      ip: freshIp(),
    }),
    { id: campaignId },
  );
  expect(res.status).toBe(201);
  const { order } = (await res.json()) as { order: { id: string; publicCode: string } };
  return { orderId: order.id, code: order.publicCode, mpId: mock.orderFor(order.id)!.id };
}

const post = (
  mod: { POST: Parameters<typeof call>[0] },
  path: string,
  code: string,
  who: Awaited<ReturnType<typeof staff>>,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  call(
    mod.POST,
    req('POST', `/api/v1/admin/orders/${code}/${path}`, {
      body,
      cookies: who.cookies,
      headers: { ...who.headers, ...headers },
    }),
    { code },
  );

async function lateApproval() {
  const first = await buyMovie();
  expect(await expireDueOrders(new Date(Date.now() + 36 * 60_000))).toBe(1);
  mock.approve(first.mpId);
  expect(await cancelPixAtProvider(first.orderId)).toBe('synced');
  expect(await syncMpOrder(first.mpId)).toBe('late-approval');
  return first;
}

describe('list and detail', () => {
  it('filters, finds by code, never shows a full e-mail', async () => {
    const mod = await staff('MODERATOR');
    const a = await buyMovie({ message: 'Bora assistir!' });
    const res = await call(
      list.GET,
      req('GET', `/api/v1/admin/orders?filtro=moderacao&q=${a.code}`, { cookies: mod.cookies }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orders: { publicCode: string }[]; counts: unknown };
    expect(body.orders.map((o) => o.publicCode)).toEqual([a.code]);
    expect(body.counts).toMatchObject({ moderacao: 1 });

    const d = await call(
      detail.GET,
      req('GET', `/api/v1/admin/orders/${a.code}`, { cookies: mod.cookies }),
      { code: a.code },
    );
    const json = await d.text();
    expect(json).toContain('***@example.com');
    expect(json).not.toMatch(/b-[0-9a-f]{8}@example\.com/);
    expect(JSON.parse(json).order.can).toMatchObject({ accept: false, refund: false });
  });
});

describe('moderation', () => {
  it('approves a pending message once; audited; the second decision → 409', async () => {
    const mod = await staff('MODERATOR');
    const a = await buyMovie({ message: 'Bora assistir!' });
    const ok = await post(moderate, 'moderate', a.code, mod, {
      field: 'message',
      decision: 'APPROVED',
    });
    expect(ok.status).toBe(200);
    expect((await db().order.findUniqueOrThrow({ where: { id: a.orderId } })).messageStatus).toBe(
      'APPROVED',
    );
    const again = await post(moderate, 'moderate', a.code, mod, {
      field: 'message',
      decision: 'REJECTED',
    });
    expect(again.status).toBe(409);
    const rows = await db().auditLog.findMany({
      where: { action: 'order.moderate', targetId: a.orderId },
    });
    expect(rows.map((r) => r.metadata)).toEqual([{ field: 'message', decision: 'APPROVED' }]);
    expect(rows[0]!.actorId).toBe(mod.user.id);
  });
});

describe('late approval (13 D4)', () => {
  it('STREAMER accepts while the movie is still free: PAID, SPONSORED, receipt re-armed, audited', async () => {
    const s = await staff('STREAMER');
    const late = await lateApproval();
    const res = await post(resolve, 'resolve', late.code, s, { outcome: 'accept' });
    expect(res.status).toBe(200);
    const o = await db().order.findUniqueOrThrow({
      where: { id: late.orderId },
      include: { emails: true },
    });
    expect(o).toMatchObject({ status: 'PAID', attentionReason: 'LATE_APPROVAL' });
    expect(o.paidAt).not.toBeNull();
    expect(o.emails[0]).toMatchObject({ template: 'ORDER_RECEIPT', status: 'PENDING' });
    expect(o.emails[0]!.sealedToken).toBeTruthy();
    expect(
      (await db().catalogItem.findUniqueOrThrow({ where: { id: late.movie.id } })).status,
    ).toBe('SPONSORED');
    const audits = await db().auditLog.findMany({
      where: { targetId: late.orderId, action: { in: ['order.resolve', 'order.paid'] } },
      orderBy: { id: 'asc' },
    });
    expect(audits.map((a) => [a.action, a.actorId])).toEqual([
      ['order.resolve', s.user.id],
      ['order.paid', s.user.id],
    ]);
    // a second accept is not possible
    expect((await post(resolve, 'resolve', late.code, s, { outcome: 'accept' })).status).toBe(409);
  });

  it('the movie went to someone else meanwhile → 409 ORDER_NO_ROOM, nothing changes', async () => {
    const s = await staff('STREAMER');
    const late = await lateApproval();
    // someone else buys the (released) movie
    const res2 = await call(
      orders.POST,
      req('POST', '/api/v1/orders', {
        body: {
          itemId: late.movie.id,
          expectedTotalCents: 2000,
          contactEmail: 'other@example.com',
          legal: LEGAL,
        },
        headers: checkoutHeaders(),
        ip: freshIp(),
      }),
    );
    expect(res2.status).toBe(201);
    const res = await post(resolve, 'resolve', late.code, s, { outcome: 'accept' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'ORDER_NO_ROOM' });
    expect((await db().order.findUniqueOrThrow({ where: { id: late.orderId } })).status).toBe(
      'NEEDS_ATTENTION',
    );
  });

  it('a MODERATOR cannot accept or refund (404), even with a fresh passkey', async () => {
    const mod = await staff('MODERATOR');
    const late = await lateApproval();
    expect((await post(resolve, 'resolve', late.code, mod, { outcome: 'accept' })).status).toBe(
      404,
    );
    expect(
      (
        await post(
          refund,
          'refund',
          late.code,
          mod,
          { reason: 'PROCESSING_ERROR' },
          { 'idempotency-key': randomUUID() },
        )
      ).status,
    ).toBe(404);
  });

  it('accept and refund need a fresh Google login (step-up) on top of the passkey', async () => {
    const u = await makeUser({ role: 'STREAMER' });
    const old = await signedIn(u, new Date(Date.now() - 30 * 60_000));
    const late = await lateApproval();
    const res = await post(
      resolve,
      'resolve',
      late.code,
      { user: u, ...old },
      { outcome: 'accept' },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });
});

describe('exception refund (04 §8)', () => {
  it('a double-click refunds once; the movie is available again; audited requested → approved', async () => {
    const s = await staff('STREAMER');
    const a = await buyMovie();
    mock.approve(a.mpId);
    expect(await syncMpOrder(a.mpId)).toBe('paid');

    const key = randomUUID();
    const [r1, r2] = await Promise.all([
      post(refund, 'refund', a.code, s, { reason: 'PROCESSING_ERROR' }, { 'idempotency-key': key }),
      post(refund, 'refund', a.code, s, { reason: 'PROCESSING_ERROR' }, { 'idempotency-key': key }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const calls = mock.requests.filter((r) => r.path.endsWith('/refund'));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['x-idempotency-key']).toBe(key);

    const o = await db().order.findUniqueOrThrow({
      where: { id: a.orderId },
      include: { payment: { include: { refunds: true } } },
    });
    expect(o.status).toBe('REFUNDED');
    expect(o.payment!.status).toBe('REFUNDED');
    expect(o.payment!.refunds).toHaveLength(1);
    expect(o.payment!.refunds[0]).toMatchObject({
      status: 'APPROVED',
      amountCents: 2000,
      reason: 'PROCESSING_ERROR',
      requestedById: s.user.id,
    });
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: a.movie.id } })).status).toBe(
      'ACTIVE',
    );
    const audits = await db().auditLog.findMany({
      where: { action: 'order.refund', targetId: a.orderId },
      orderBy: { id: 'asc' },
    });
    expect(audits.map((x) => (x.metadata as { state: string }).state)).toEqual([
      'requested',
      'approved',
    ]);
    // nothing more to refund
    const again = await post(
      refund,
      'refund',
      a.code,
      s,
      { reason: 'PROCESSING_ERROR' },
      { 'idempotency-key': randomUUID() },
    );
    expect(again.status).toBe(409);
  });

  it('Mercado Pago down → 502, the refund stays REQUESTED and a retry sends the same key', async () => {
    const s = await staff('STREAMER');
    const a = await buyMovie();
    mock.approve(a.mpId);
    await syncMpOrder(a.mpId);
    mock.failNext(3, 503, /\/refund$/);
    const key = randomUUID();
    const r1 = await post(
      refund,
      'refund',
      a.code,
      s,
      { reason: 'DUPLICATE_PAYMENT' },
      {
        'idempotency-key': key,
      },
    );
    expect(r1.status).toBe(502);
    const pending = await db().refund.findFirstOrThrow({ where: { idempotencyKey: key } });
    expect(pending.status).toBe('REQUESTED');
    expect((await db().order.findUniqueOrThrow({ where: { id: a.orderId } })).status).toBe(
      'REFUND_PENDING',
    );
    // after a reload the page has a new key: the open refund is reused with ITS key
    const r2 = await post(
      refund,
      'refund',
      a.code,
      s,
      { reason: 'DUPLICATE_PAYMENT' },
      {
        'idempotency-key': randomUUID(),
      },
    );
    expect(r2.status).toBe(200);
    const sent = mock.requests.filter((r) => r.path.endsWith('/refund'));
    expect(new Set(sent.map((r) => r.headers['x-idempotency-key']))).toEqual(new Set([key]));
    expect((await db().order.findUniqueOrThrow({ where: { id: a.orderId } })).status).toBe(
      'REFUNDED',
    );
  });

  it('a refunded contribution leaves the campaign (a funded one re-opens)', async () => {
    const s = await staff('STREAMER');
    const { campaign } = await makeCampaign({ goalCents: 2000 });
    const c = await contribute(campaign.id, 2000);
    mock.approve(c.mpId);
    expect(await syncMpOrder(c.mpId)).toBe('paid');
    expect((await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      'FUNDED',
    );
    const r = await post(
      refund,
      'refund',
      c.code,
      s,
      { reason: 'LEGAL_REQUIREMENT' },
      {
        'idempotency-key': randomUUID(),
      },
    );
    expect(r.status).toBe(200);
    const after = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(after).toMatchObject({
      status: 'OPEN',
      raisedCents: 0,
      remainingCents: 2000,
      supporterCount: 0,
      fundedAt: null,
    });
  });

  it('a late approval with no room can be refunded (no catalog change)', async () => {
    const s = await staff('STREAMER');
    const late = await lateApproval();
    const r = await post(
      refund,
      'refund',
      late.code,
      s,
      { reason: 'PROCESSING_ERROR' },
      {
        'idempotency-key': randomUUID(),
      },
    );
    expect(r.status).toBe(200);
    expect((await db().order.findUniqueOrThrow({ where: { id: late.orderId } })).status).toBe(
      'REFUNDED',
    );
    expect(
      (await db().catalogItem.findUniqueOrThrow({ where: { id: late.movie.id } })).status,
    ).toBe('ACTIVE');
  });
});
