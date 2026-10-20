/**
 * Phase 2 checkout (13 §3 steps 3–7): movie sponsorships and campaign contributions through the
 * real route handlers, database and Redis, with Mercado Pago / Turnstile mocked locally.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as orders from '@/app/api/v1/orders/route';
import * as quote from '@/app/api/v1/orders/quote/route';
import * as orderGet from '@/app/api/v1/orders/[code]/route';
import * as orderAccess from '@/app/api/v1/orders/[code]/access/route';
import * as orderCancel from '@/app/api/v1/orders/[code]/cancel/route';
import * as orderClaim from '@/app/api/v1/orders/[code]/claim/route';
import * as myOrders from '@/app/api/v1/me/orders/route';
import * as contributions from '@/app/api/v1/campaigns/[id]/contributions/route';
import { COOKIE } from '@/server/auth/cookies';
import { db } from '@/server/db';
import { recoverFailedCreate } from '@/server/orders/checkout';
import { syncMpOrder } from '@/server/payments/sync';
import { clearCatalog, makeCampaign, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { call, freshIp, req, setCookies, signedIn } from '../support/http';
import { checkoutHeaders, LEGAL, installPaymentsMock } from '../support/payments';

const mock = installPaymentsMock();

beforeEach(async () => {
  await clearCatalog();
  await db().voucher.deleteMany({});
});

type Json = Record<string, unknown>;
const json = async (res: Response) => (await res.json()) as Json;

function movieBody(itemId: string, over: Json = {}) {
  return {
    itemId,
    expectedTotalCents: 2000,
    contactEmail: `guest-${randomUUID().slice(0, 8)}@example.com`,
    legal: LEGAL,
    ...over,
  };
}

async function sponsor(
  itemId: string,
  over: Json = {},
  init: { headers?: Record<string, string>; cookies?: Record<string, string>; ip?: string } = {},
) {
  return call(
    orders.POST,
    req('POST', '/api/v1/orders', {
      body: movieBody(itemId, over),
      headers: { ...checkoutHeaders(), ...init.headers },
      cookies: init.cookies ?? {},
      ip: init.ip ?? freshIp(),
    }),
  );
}

async function contribute(
  campaignId: string,
  amountCents: number,
  over: Json = {},
  init: { headers?: Record<string, string>; ip?: string } = {},
) {
  return call(
    contributions.POST,
    req('POST', `/api/v1/campaigns/${campaignId}/contributions`, {
      body: {
        amountCents,
        contactEmail: `fan-${randomUUID().slice(0, 8)}@example.com`,
        legal: LEGAL,
        ...over,
      },
      headers: { ...checkoutHeaders(), ...init.headers },
      ip: init.ip ?? freshIp(),
    }),
    { id: campaignId },
  );
}

describe('movie sponsorship', () => {
  it('guest checkout: Pix created, movie reserved, everything held in one transaction', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 1, runtimeMinutes: 115 });
    const res = await sponsor(movie.id);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      order: { id: string; publicCode: string; totalCents: number; status: string };
      pix: { qrCode: string; qrCodeBase64: string; expiresAt: string };
      accessToken: string;
    };
    expect(body.order.publicCode).toMatch(/^WF-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(body.order.totalCents).toBe(2000);
    expect(body.pix.qrCode).toContain('br.gov.bcb.pix');
    expect(body.accessToken).toMatch(/^[\w-]{43}$/);
    // order cookie: sealed, HttpOnly, Secure, SameSite=Strict, host-only
    const c = setCookies(res)[COOKIE.order]!;
    expect(c.value).toMatch(/^v1\./);
    expect(c.attributes).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'strict',
      path: '/',
    });

    const row = await db().order.findUniqueOrThrow({
      where: { id: body.order.id },
      include: { payment: true, legalAcceptances: true, emails: true },
    });
    expect(row.status).toBe('PENDING_PAYMENT');
    expect(row.buyerKey).toMatch(/^e:[0-9a-f]{64}$/);
    expect(Buffer.from(row.accessTokenHash).toString('hex')).not.toContain(body.accessToken);
    expect(row.legalAcceptances).toHaveLength(3);
    expect(row.emails).toMatchObject([{ template: 'ORDER_RECEIPT', status: 'HELD' }]);
    expect(row.payment).toMatchObject({ status: 'PENDING', amountCents: 2000 });
    expect(row.payment!.providerOrderId).toMatch(/^ORD/);

    const item = await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } });
    expect(item.reservedOrderId).toBe(row.id);
    expect(item.reservedUntil!.getTime() - Date.now()).toBeGreaterThan(34 * 60_000);

    // what Mercado Pago received
    const create = mock.requests.find((r) => r.method === 'POST' && r.path === '/v1/orders')!;
    expect(create.headers['x-idempotency-key']).toBe(row.payment!.idempotencyKey);
    expect(create.body).toMatchObject({
      type: 'online',
      processing_mode: 'automatic',
      external_reference: row.id,
      total_amount: '20.00',
      payer: { email: 'test@testuser.com' }, // sandbox payer outside production
      transactions: {
        payments: [
          {
            amount: '20.00',
            payment_method: { id: 'pix', type: 'bank_transfer' },
            expiration_time: 'PT30M',
          },
        ],
      },
    });
  });

  it('signed-in moderator gets the 10 % perk; the client never sends prices', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 2, runtimeMinutes: 172 });
    const mod = await makeUser({ role: 'MODERATOR' });
    const auth = await signedIn(mod);
    const q = await call(
      quote.POST,
      req('POST', '/api/v1/orders/quote', {
        body: { itemId: movie.id, queueJumpTierId: 'prioridade' },
        cookies: auth.cookies,
        headers: auth.headers,
      }),
    );
    expect(q.status).toBe(200);
    const quoted = (await q.json()) as { breakdown: { totalCents: number } };
    // 172 min: S = 6200, perk 620, Prioridade 4960
    expect(quoted.breakdown.totalCents).toBe(10_540);

    // tamper: unknown fields are rejected outright
    const tampered = await sponsor(
      movie.id,
      {
        expectedTotalCents: 10_540,
        queueJumpTierId: 'prioridade',
        totalCents: 1,
        contactEmail: undefined,
      },
      { cookies: auth.cookies, headers: auth.headers },
    );
    expect(tampered.status).toBe(422);

    const res = await sponsor(
      movie.id,
      { expectedTotalCents: 10_540, queueJumpTierId: 'prioridade', contactEmail: undefined },
      { cookies: auth.cookies, headers: auth.headers },
    );
    expect(res.status).toBe(201);
    const o = await db().order.findFirstOrThrow({
      where: { itemId: movie.id },
      include: { queueJumpSlot: true },
    });
    expect(o).toMatchObject({
      userId: mod.id,
      buyerKey: `u:${mod.id}`,
      discountCents: 620,
      queueJumpCents: 4960,
      totalCents: 10_540,
    });
    expect(o.contactEmail).toBe(mod.email.toLowerCase());
    expect(o.queueJumpSlot).toMatchObject({
      tierId: 'prioridade',
      confirmed: false,
      multiplierBps: 8000,
    });
  });

  it('a stale expected total answers 409 PRICE_CHANGED with the new breakdown, never charges', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 3, runtimeMinutes: 140 });
    const res = await sponsor(movie.id, { expectedTotalCents: 2000 });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.code).toBe('PRICE_CHANGED');
    expect((body.breakdown as { totalCents: number }).totalCents).toBe(3000);
    expect(await db().order.count()).toBe(0);
    expect(mock.requests.filter((r) => r.path === '/v1/orders')).toHaveLength(0);
  });

  it('legal versions must be the current ones', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 4 });
    const res = await sponsor(movie.id, { legal: { ...LEGAL, terms: '2020-01-01' } });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('LEGAL_VERSION_CHANGED');
    expect(await db().order.count()).toBe(0);
  });

  it('Turnstile and Idempotency-Key are required', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 5 });
    expect((await sponsor(movie.id, {}, { headers: { 'x-turnstile-token': 'bad' } })).status).toBe(
      403,
    );
    const noKey = await call(
      orders.POST,
      req('POST', '/api/v1/orders', {
        body: movieBody(movie.id),
        headers: { 'x-turnstile-token': 'e2e-ok:checkout' },
      }),
    );
    expect(noKey.status).toBe(400);
    expect((await json(noKey)).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    // a token minted for another action doesn't pass
    expect(
      (await sponsor(movie.id, {}, { headers: { 'x-turnstile-token': 'e2e-ok:contact' } })).status,
    ).toBe(403);
  });

  it('same Idempotency-Key replays the same answer (one order, one Pix); another body → 409', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 6 });
    const key = randomUUID();
    const body = movieBody(movie.id);
    const send = (b: Json) =>
      call(orders.POST, req('POST', '/api/v1/orders', { body: b, headers: checkoutHeaders(key) }));
    const a = await send(body);
    const b = await send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await b.json()).toEqual(await a.json());
    expect(await db().order.count()).toBe(0 + 1);
    expect(
      mock.requests.filter((r) => r.path === '/v1/orders' && r.method === 'POST'),
    ).toHaveLength(1);
    const c = await send({ ...body, showSponsorName: false });
    expect(c.status).toBe(409);
    expect((await json(c)).code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('two buyers racing for one movie: exactly one Pix', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 7 });
    const results = await Promise.all(Array.from({ length: 10 }, () => sponsor(movie.id)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s !== 201).every((s) => s === 409)).toBe(true);
    expect(await db().order.count({ where: { status: 'PENDING_PAYMENT' } })).toBe(1);
  });

  it('one unpaid order per buyer; at most two per IP', async () => {
    const [m1, m2, m3, m4] = await Promise.all(
      [8, 9, 10, 11].map((slot) => makeItem({ status: 'ACTIVE', slot })),
    );
    const email = 'same-buyer@example.com';
    expect((await sponsor(m1!.id, { contactEmail: email })).status).toBe(201);
    const second = await sponsor(m2!.id, { contactEmail: 'SAME-buyer@Example.com ' });
    expect(second.status).toBe(409);
    expect((await json(second)).code).toBe('PENDING_ORDER_EXISTS');

    const ip = freshIp();
    const paidSoon = await sponsor(m2!.id, {}, { ip });
    expect(paidSoon.status).toBe(201);
    expect((await sponsor(m3!.id, {}, { ip })).status).toBe(201);
    const third = await sponsor(m4!.id, {}, { ip });
    expect(third.status).toBe(429);
    expect((await json(third)).code).toBe('PENDING_ORDERS_IP_LIMIT');

    // only UNPAID orders count: once one is paid, the next person on that IP (a carrier NAT) can buy
    const { order } = (await json(paidSoon)) as { order: { id: string } };
    mock.approve(mock.orderFor(order.id)!.id);
    expect(await syncMpOrder(mock.orderFor(order.id)!.id)).toBe('paid');
    expect((await sponsor(m4!.id, {}, { ip })).status).toBe(201);
  });

  it('the per-IP limit holds under concurrency: 8 parallel checkouts from one IP → 2 Pix', async () => {
    const movies = await Promise.all(
      Array.from({ length: 8 }, (_, i) => makeItem({ status: 'ACTIVE', slot: 20 + i })),
    );
    const ip = freshIp();
    const results = await Promise.all(movies.map((m) => sponsor(m.id, {}, { ip })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 429)).toHaveLength(6);
  });

  it('Mercado Pago down → 503, nothing charged, every hold released, recovery cancels a late create', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 12 });
    mock.failNext(3, 503, /^\/v1\/orders$/);
    const res = await sponsor(movie.id);
    expect(res.status).toBe(503);
    expect((await json(res)).code).toBe('PIX_UNAVAILABLE');
    const o = await db().order.findFirstOrThrow({
      where: { itemId: movie.id },
      include: { payment: true, emails: true },
    });
    expect(o.status).toBe('CANCELLED');
    expect(o.emails[0]!.status).toBe('CANCELLED');
    expect(o.emails[0]!.sealedToken).toBeNull();
    const item = await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } });
    expect(item.reservedOrderId).toBeNull();
    // the movie can be bought right away by someone else
    expect((await sponsor(movie.id)).status).toBe(201);
    // recovery: retry the create with the same key (MP answers with the same order) and cancel it
    expect(await recoverFailedCreate(o.id)).toBe('cancelled');
    const mpOrder = mock.orderFor(o.id)!;
    expect(mpOrder.status).toBe('canceled');
  });

  it('a reservation past its window is expired inline when the next buyer arrives', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 13 });
    expect((await sponsor(movie.id)).status).toBe(201);
    const first = await db().order.findFirstOrThrow({ where: { itemId: movie.id } });
    await db().catalogItem.update({
      where: { id: movie.id },
      data: { reservedUntil: new Date(Date.now() - 1000) },
    });
    expect((await sponsor(movie.id)).status).toBe(201);
    expect((await db().order.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
      'EXPIRED',
    );
  });

  it('sponsored or unknown movies are not for sale; contributions never use movie checkout', async () => {
    const sold = await makeItem({ status: 'SPONSORED', slot: 14 });
    expect((await sponsor(sold.id)).status).toBe(409);
    expect((await sponsor(randomUUID())).status).toBe(404);
    const { item } = await makeCampaign({ slot: 2 });
    expect((await sponsor(item.id)).status).toBe(404);
  });

  it('vouchers: applied when better than the perk, reserved once per buyer, sold-out is race-free', async () => {
    await db().voucher.create({
      data: {
        code: 'ESQUILO-10',
        kind: 'FIXED',
        amountCents: 1000,
        maxRedemptions: 3,
        maxPerUser: 1,
      },
    });
    const movies = await Promise.all(
      Array.from({ length: 8 }, (_, i) => makeItem({ status: 'ACTIVE', slot: 20 + i })),
    );
    const results = await Promise.all(
      movies.map((m) => sponsor(m.id, { voucherCode: 'esquilo-10', expectedTotalCents: 1000 })),
    );
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(3);
    const v = await db().voucher.findUniqueOrThrow({ where: { code: 'ESQUILO-10' } });
    expect(v.redemptionCount).toBe(3);
    expect(await db().voucherRedemption.count({ where: { status: 'RESERVED' } })).toBe(3);
    for (const r of results.filter((x) => x.status !== 201)) {
      expect((await json(r)).code).toMatch(/VOUCHER_SOLD_OUT/);
    }
  });

  it('invalid voucher codes trigger a cool-down after five tries', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 30 });
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await call(
        quote.POST,
        req('POST', '/api/v1/orders/quote', {
          body: { itemId: movie.id, voucherCode: `NAOEXISTE${i}` },
          ip,
        }),
      );
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 5)).toEqual([422, 422, 422, 422, 422]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('queue jump: shared daily cap, "topo" 1/day and 1 per buyer — never exceeded under concurrency', async () => {
    const movies = await Promise.all(
      Array.from({ length: 12 }, (_, i) => makeItem({ status: 'ACTIVE', slot: 1 + i })),
    );
    const topo = await Promise.all(
      movies
        .slice(0, 6)
        .map((m) => sponsor(m.id, { queueJumpTierId: 'topo', expectedTotalCents: 5200 })),
    );
    expect(topo.filter((r) => r.status === 201)).toHaveLength(1);
    const prio = await Promise.all(
      movies
        .slice(6)
        .map((m) => sponsor(m.id, { queueJumpTierId: 'prioridade', expectedTotalCents: 3600 })),
    );
    // daily cap 5 shared: 1 topo + 4 prioridade
    expect(prio.filter((r) => r.status === 201)).toHaveLength(4);
    expect(await db().queueJumpSlot.count()).toBe(5);
    const codes = await Promise.all(
      prio.filter((r) => r.status !== 201).map(async (r) => (await json(r)).code),
    );
    expect(new Set(codes)).toEqual(new Set(['QUEUE_JUMP_SOLD_OUT']));
  });
});

describe('order access (guest link, cookie, owner)', () => {
  it('the order is visible to its cookie holder and owner only; the link token grants the cookie', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 1 });
    const res = await sponsor(movie.id);
    const body = (await res.json()) as { order: { publicCode: string }; accessToken: string };
    const cookie = setCookies(res)[COOKIE.order]!.value;
    const code = body.order.publicCode;
    const get = (cookies: Record<string, string> = {}) =>
      call(orderGet.GET, req('GET', `/api/v1/orders/${code}`, { cookies }), { code });

    expect((await get()).status).toBe(404);
    const mine = await get({ [COOKIE.order]: cookie });
    expect(mine.status).toBe(200);
    const view = (await mine.json()) as { order: Json & { pix: Json | null } };
    expect(view.order).toMatchObject({
      status: 'PENDING_PAYMENT',
      canCancel: true,
      claimed: false,
    });
    expect(view.order.contactEmail).toMatch(/^gu\*\*\*@example\.com$/);
    expect(view.order.pix).toMatchObject({ qrCode: expect.stringContaining('br.gov.bcb.pix') });

    // another browser: wrong token → 404, right token → cookie
    const wrong = await call(
      orderAccess.POST,
      req('POST', `/api/v1/orders/${code}/access`, { body: { token: 'x'.repeat(43) } }),
      { code },
    );
    expect(wrong.status).toBe(404);
    const right = await call(
      orderAccess.POST,
      req('POST', `/api/v1/orders/${code}/access`, { body: { token: body.accessToken } }),
      { code },
    );
    expect(right.status).toBe(200);
    const newCookie = setCookies(right)[COOKIE.order]!.value;
    expect((await get({ [COOKIE.order]: newCookie })).status).toBe(200);

    // a stranger with an account still gets 404 — staff too (they use /admin/pedidos, behind
    // the passkey, which never shows the Pix)
    const stranger = await signedIn(await makeUser());
    expect((await get(stranger.cookies)).status).toBe(404);
    const staff = await signedIn(await makeUser({ role: 'MODERATOR' }));
    expect((await get(staff.cookies)).status).toBe(404);
  });

  it('the buyer cancels an unpaid order: Pix cancelled first, holds released; paid orders cannot be cancelled', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 2 });
    const res = await sponsor(movie.id);
    const { order } = (await res.json()) as { order: { id: string; publicCode: string } };
    const cookies = { [COOKIE.order]: setCookies(res)[COOKIE.order]!.value };
    const code = order.publicCode;
    const cancel = () =>
      call(orderCancel.POST, req('POST', `/api/v1/orders/${code}/cancel`, { cookies }), { code });
    const r = await cancel();
    expect(r.status).toBe(200);
    expect(mock.orderFor(order.id)!.status).toBe('canceled');
    const row = await db().order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    expect(row.status).toBe('CANCELLED');
    expect(row.payment!.status).toBe('CANCELLED');
    expect(
      (await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).reservedOrderId,
    ).toBeNull();
    expect((await cancel()).status).toBe(409);
  });

  it('a signed-in user claims a guest order and sees it under "Minhas compras"', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 3 });
    const res = await sponsor(movie.id);
    const { order } = (await res.json()) as { order: { id: string; publicCode: string } };
    const orderCookie = setCookies(res)[COOKIE.order]!.value;
    const user = await makeUser();
    const auth = await signedIn(user);
    const code = order.publicCode;
    const claim = await call(
      orderClaim.POST,
      req('POST', `/api/v1/orders/${code}/claim`, {
        cookies: { ...auth.cookies, [COOKIE.order]: orderCookie },
        headers: auth.headers,
      }),
      { code },
    );
    expect(claim.status).toBe(200);
    const row = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.userId).toBe(user.id);
    expect(row.buyerKey).toMatch(/^e:/); // purchase-time buyer stays
    const list = await call(
      myOrders.GET,
      req('GET', '/api/v1/me/orders', { cookies: auth.cookies }),
    );
    const { orders: mine } = (await list.json()) as { orders: { publicCode: string }[] };
    expect(mine.map((o) => o.publicCode)).toEqual([code]);
    // without the cookie nobody can claim
    const other = await signedIn(await makeUser());
    const steal = await call(
      orderClaim.POST,
      req('POST', `/api/v1/orders/${code}/claim`, {
        cookies: other.cookies,
        headers: other.headers,
      }),
      { code },
    );
    expect(steal.status).toBe(404);
  });
});

describe('campaign contributions', () => {
  it('whole reais ≥ R$ 5, capped at what is left; reserved while pending', async () => {
    const { campaign } = await makeCampaign({ goalCents: 3000 });
    for (const bad of [499, 550, 1050]) {
      const r = await contribute(campaign.id, bad);
      expect(r.status).toBe(422);
    }
    const above = await contribute(campaign.id, 3100);
    expect(above.status).toBe(409);
    expect(await json(above)).toMatchObject({
      code: 'AMOUNT_ABOVE_REMAINING',
      remainingCents: 3000,
    });
    const ok = await contribute(campaign.id, 2000);
    expect(ok.status).toBe(201);
    const c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({ reservedCents: 2000, remainingCents: 1000, raisedCents: 0 });
    const o = await db().order.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(o).toMatchObject({
      kind: 'CONTRIBUTION',
      totalCents: 2000,
      discountCents: 0,
      queueJumpCents: 0,
    });
  });

  it('never leaves less than R$ 5 to go: up to remaining − R$ 5, or exactly the remainder', async () => {
    const { campaign } = await makeCampaign({ goalCents: 2300 });
    // R$ 23 left: R$ 20 would leave R$ 3 that nobody could pay
    const leaves3 = await contribute(campaign.id, 2000);
    expect(leaves3.status).toBe(409);
    expect(await json(leaves3)).toMatchObject({
      code: 'AMOUNT_ABOVE_REMAINING',
      remainingCents: 2300,
    });
    expect((await contribute(campaign.id, 1800)).status).toBe(201); // leaves R$ 5
    expect((await contribute(campaign.id, 500)).status).toBe(201); // exactly the remainder
    const c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({ reservedCents: 2300, remainingCents: 0 });
    expect(await json(await contribute(campaign.id, 500))).toMatchObject({
      code: 'AMOUNT_ABOVE_REMAINING',
      remainingCents: 0,
    });
  });

  it('no overfunding: 30 parallel R$ 10 contributions to a R$ 100 goal → exactly 10 reserved', async () => {
    const { campaign } = await makeCampaign({ goalCents: 10_000 });
    const results = await Promise.all(
      Array.from({ length: 30 }, () => contribute(campaign.id, 1000)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    const c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({ reservedCents: 10_000, remainingCents: 0 });
  });

  it('a campaign past its deadline (paused) or funded takes no contributions', async () => {
    const { campaign } = await makeCampaign({ days: -1 });
    const r = await contribute(campaign.id, 500);
    expect(r.status).toBe(409);
    expect((await json(r)).code).toBe('CAMPAIGN_CLOSED');
    expect((await contribute(randomUUID(), 500)).status).toBe(404);
  });

  it('display name and message are sanitised and wait for moderation', async () => {
    const { campaign } = await makeCampaign();
    const r = await contribute(campaign.id, 500, {
      displayName: 'Ana\u202E<script>',
      message: 'Valeu!\u0000 <b>oi</b>',
      showSponsorName: true,
    });
    expect(r.status).toBe(201);
    const o = await db().order.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(o.guestDisplayName).toBe('Ana<script>');
    expect(o.displayNameStatus).toBe('PENDING');
    expect(o.sponsorMessage).toBe('Valeu! <b>oi</b>');
    expect(o.messageStatus).toBe('PENDING');
  });
});
