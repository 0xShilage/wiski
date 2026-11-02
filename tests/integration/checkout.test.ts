/**
 * Checkout (Phase 2 exit criteria, 00 README phase plan): movie sponsorship and campaign
 * contributions end to end against a fake Mercado Pago, the money invariants under concurrency
 * (one sponsor per movie, no overfunding, queue-jump caps, voucher limits, one unpaid order per
 * buyer, two per IP), tamper and idempotency behaviour, and failure compensation.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { syncPayment } from '@/server/payments/sync';
import { resetRuleSetCache } from '@/server/pricing/ruleset';
import { clearCatalog } from '../support/catalog';
import {
  contribute,
  contributionBody,
  getOrder,
  type Legal,
  liveMovie,
  movieBody,
  openCampaignFor,
  orderByCode,
  orderCookie,
  quote,
  sponsor,
} from '../support/checkout';
import { makeUser } from '../support/db';
import { freshIp, signedIn } from '../support/http';
import { ensureLegal, type FakeMp, installFakeMp, PIX_CODE, PNG_1PX } from '../support/mercadopago';

let legal: Legal;
let mp: FakeMp;

beforeAll(async () => {
  await clearCatalog();
  legal = await ensureLegal();
});
beforeEach(async () => {
  mp = installFakeMp();
  await clearCatalog();
});

async function liveMovies(n: number, runtime = 115) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await liveMovie(runtime));
  return out;
}

describe('movie sponsorship — happy path (guest)', () => {
  it('quotes, reserves, creates the Pix, and turns into a sale when MP approves', async () => {
    const movie = await liveMovie(131);
    const q = await quote({ movieId: movie.id, queueJumpTier: null });
    expect(q.res.status).toBe(200);
    expect(q.json.totalCents).toBe(2100);
    expect(q.json.available).toBe(true);

    const body = movieBody(movie.id, legal, { expectedTotalCents: 2100, displayName: 'Esquilo' });
    const { res, json, cookies } = await sponsor(body);
    expect(res.status).toBe(201);
    expect(json).toMatchObject({
      status: 'PENDING_PAYMENT',
      totalCents: 2100,
      qrCode: PIX_CODE,
      qrCodeBase64: PNG_1PX,
    });
    expect(json.publicCode).toMatch(/^WF-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(json.accessToken).toMatch(/^[\w-]{43}$/);
    const c = cookies['__Host-wf_order']!;
    expect(c.attributes).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'strict',
      path: '/',
    });

    // what was sent to Mercado Pago
    const call = mp.calls.find((x) => x.method === 'POST')!;
    const order = await orderByCode(json.publicCode as string);
    expect(call.body).toMatchObject({
      transaction_amount: 21,
      payment_method_id: 'pix',
      external_reference: order.id,
      payer: { email: body.contactEmail },
    });
    expect((call.body as { date_of_expiration: string }).date_of_expiration).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}-03:00$/,
    );
    expect(call.headers['x-idempotency-key']).toBe(order.payment!.idempotencyKey);
    expect(call.body).not.toHaveProperty('notification_url');

    // holds
    expect(order).toMatchObject({
      status: 'PENDING_PAYMENT',
      totalCents: 2100,
      guestDisplayName: 'Esquilo',
    });
    expect(order.ipKey).toMatch(/^[\w-]{16}$/);
    expect(order.item.reservedOrderId).toBe(order.id);
    expect(order.payment!.providerPaymentId).toBe(String(mp.forOrder(order.id).id));
    expect(await db().legalAcceptance.count({ where: { orderId: order.id } })).toBe(3);

    // the order page (cookie) shows the Pix
    const view = await getOrder(order.publicCode, { cookies: orderCookie(cookies) });
    expect(view.res.status).toBe(200);
    expect((view.json.order as { pix: unknown }).pix).toEqual({
      qrCode: PIX_CODE,
      qrCodeBase64: PNG_1PX,
    });
    expect((view.json.order as { contactEmail: string }).contactEmail).not.toContain(
      body.contactEmail.split('@')[0]!.slice(1),
    );

    // MP approves → sale
    mp.approve(Number(order.payment!.providerPaymentId));
    expect(await syncPayment(order.payment!.providerPaymentId!)).toBe('applied');
    const paid = await orderByCode(order.publicCode);
    expect(paid.status).toBe('PAID');
    expect(paid.paidAt).not.toBeNull();
    expect(paid.ipKey).toBeNull();
    expect(paid.payment!.status).toBe('APPROVED');
    expect(paid.item).toMatchObject({
      status: 'SPONSORED',
      reservedOrderId: null,
      reservedUntil: null,
    });
    const after = await getOrder(order.publicCode, { cookies: orderCookie(cookies) });
    expect(after.json.order).toMatchObject({ status: 'PAID', pix: null });
    // a second sync is a no-op
    expect(await syncPayment(order.payment!.providerPaymentId!)).toBe('unchanged');
    const audits = await db().auditLog.findMany({
      where: { targetId: order.id },
      orderBy: { id: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual(['order.create', 'payment.status']);
  });

  it('signed-in buyers default to their Google e-mail; moderators get the 10 % perk', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    const auth = await signedIn(mod);
    const movie = await liveMovie(100);
    const q = await quote({ movieId: movie.id, queueJumpTier: null }, auth);
    expect(q.json.totalCents).toBe(1800);
    const { res, json } = await sponsor(
      { movieId: movie.id, queueJumpTier: null, expectedTotalCents: 1800, legal },
      auth,
    );
    expect(res.status).toBe(201);
    const order = await orderByCode(json.publicCode as string);
    expect(order).toMatchObject({
      userId: mod.id,
      contactEmail: mod.email,
      discountCents: 200,
      buyerKey: `u:${mod.id}`,
    });
  });

  it('guests never get a perk, and cannot ask for one (strict body)', async () => {
    const movie = await liveMovie(100);
    const tampered = await sponsor(movieBody(movie.id, legal, { discountCents: 200 }));
    expect(tampered.res.status).toBe(422);
    const priced = await sponsor(movieBody(movie.id, legal, { totalCents: 1 }));
    expect(priced.res.status).toBe(422);
    expect(await db().order.count({ where: { itemId: movie.id } })).toBe(0);
  });
});

describe('movie sponsorship — refusals', () => {
  it('PRICE_CHANGED when the expected total differs, nothing held', async () => {
    const movie = await liveMovie(150);
    const r = await sponsor(movieBody(movie.id, legal, { expectedTotalCents: 2000 }));
    expect(r.res.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'PRICE_CHANGED', totalCents: '4000' });
    const item = await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } });
    expect(item.reservedOrderId).toBeNull();
    expect(mp.calls).toHaveLength(0);
  });

  it('needs Turnstile, an Idempotency-Key, a guest e-mail and the current legal versions', async () => {
    const movie = await liveMovie();
    mp.turnstile = false;
    expect((await sponsor(movieBody(movie.id, legal))).res.status).toBe(403);
    mp.turnstile = true;
    expect(
      (await sponsor(movieBody(movie.id, legal), { headers: { 'idempotency-key': 'nope' } })).res
        .status,
    ).toBe(422);
    const noEmail = movieBody(movie.id, legal);
    delete (noEmail as Partial<typeof noEmail>).contactEmail;
    expect((await sponsor(noEmail)).json.code).toBe('VALIDATION_FAILED');
    const old = await sponsor(movieBody(movie.id, { ...legal, terms: 'antigo' }));
    expect(old.res.status).toBe(409);
    expect(old.json.code).toBe('LEGAL_CHANGED');
  });

  it('is closed (503) without Mercado Pago credentials — fail closed', async () => {
    vi.stubEnv('MP_ACCESS_TOKEN', '');
    resetEnvCache();
    const movie = await liveMovie();
    const r = await sponsor(movieBody(movie.id, legal));
    expect(r.res.status).toBe(503);
    expect(r.json).toMatchObject({
      code: 'SPONSORSHIPS_CLOSED',
      reason: 'PAYMENTS_NOT_CONFIGURED',
    });
  });

  it('is closed when the streamer switches orders off', async () => {
    await db().appSetting.upsert({
      where: { key: 'orders.open' },
      update: { value: false },
      create: { key: 'orders.open', value: false },
    });
    try {
      const movie = await liveMovie();
      const r = await sponsor(movieBody(movie.id, legal));
      expect(r.json).toMatchObject({ code: 'SPONSORSHIPS_CLOSED', reason: 'CLOSED_BY_STREAMER' });
    } finally {
      await db().appSetting.delete({ where: { key: 'orders.open' } });
    }
  });

  it('does not sell a sponsored, reserved or unpublished movie', async () => {
    const draft = await (
      await import('../support/catalog')
    ).makeItem({ kind: 'MOVIE', status: 'DRAFT' });
    expect((await sponsor(movieBody(draft.id, legal))).res.status).toBe(404);
    const movie = await liveMovie();
    expect((await sponsor(movieBody(movie.id, legal))).res.status).toBe(201);
    const again = await sponsor(movieBody(movie.id, legal));
    expect(again.res.status).toBe(409);
    expect(again.json.code).toBe('MOVIE_UNAVAILABLE');
  });
});

describe('concurrency — one sponsor per movie (11 §9)', () => {
  it('20 buyers racing for one movie: exactly one order, one Pix', async () => {
    const movie = await liveMovie();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => sponsor(movieBody(movie.id, legal), { ip: freshIp() })),
    );
    const statuses = results.map((r) => r.res.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(
      results.filter((r) => r.res.status === 409).every((r) => r.json.code === 'MOVIE_UNAVAILABLE'),
    ).toBe(true);
    expect(await db().order.count({ where: { itemId: movie.id } })).toBe(1);
    expect(mp.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('buyer limits', () => {
  it('one unpaid order per buyer (e-mail), two per IP', async () => {
    const ip = freshIp();
    const email = `limite-${randomUUID().slice(0, 6)}@example.com`;
    const [m1, m2, m3, m4] = [
      await liveMovie(),
      await liveMovie(),
      await liveMovie(),
      await liveMovie(),
    ];
    expect(
      (await sponsor(movieBody(m1.id, legal, { contactEmail: email }), { ip })).res.status,
    ).toBe(201);
    const same = await sponsor(movieBody(m2.id, legal, { contactEmail: email.toUpperCase() }), {
      ip: freshIp(),
    });
    expect(same.res.status).toBe(409);
    expect(same.json.code).toBe('PENDING_ORDER_EXISTS');
    expect((await sponsor(movieBody(m3.id, legal), { ip })).res.status).toBe(201);
    const third = await sponsor(movieBody(m4.id, legal), { ip });
    expect(third.res.status).toBe(429);
    expect(third.json.code).toBe('PENDING_ORDER_LIMIT');
  });

  it('the same Idempotency-Key from the same buyer replays the first answer', async () => {
    const movie = await liveMovie();
    const body = movieBody(movie.id, legal);
    const key = randomUUID();
    const a = await sponsor(body, { idempotencyKey: key });
    const b = await sponsor(body, { idempotencyKey: key });
    expect(a.res.status).toBe(201);
    expect(b.res.status).toBe(201);
    expect(b.json).toEqual(a.json);
    expect(await db().order.count({ where: { itemId: movie.id } })).toBe(1);
    expect(mp.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('Mercado Pago failures are compensated', () => {
  it('5xx on create → 503, the movie is free again, nothing to pay', async () => {
    mp.failCreate = { status: 500, times: 1 };
    const movie = await liveMovie();
    const r = await sponsor(movieBody(movie.id, legal));
    expect(r.res.status).toBe(503);
    expect(r.json.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    const order = await db().order.findFirstOrThrow({
      where: { itemId: movie.id },
      include: { payment: true, item: true },
    });
    expect(order.status).toBe('CANCELLED');
    expect(order.ipKey).toBeNull();
    expect(order.payment!.status).toBe('CANCELLED');
    expect(order.item.reservedOrderId).toBeNull();
    // and the movie can be bought right away
    expect((await sponsor(movieBody(movie.id, legal))).res.status).toBe(201);
  });

  it('timeout on create → 503 and released', async () => {
    mp.failCreate = { timeout: true, times: 1 };
    const movie = await liveMovie();
    expect((await sponsor(movieBody(movie.id, legal))).res.status).toBe(503);
    expect(
      (await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).reservedOrderId,
    ).toBeNull();
  });

  it('a created payment that fails verification (amount) is never shown', async () => {
    mp.tamperCreate = (p) => void (p.transaction_amount = 0.01);
    const movie = await liveMovie();
    const r = await sponsor(movieBody(movie.id, legal));
    expect(r.res.status).toBe(503);
    expect(r.json).not.toHaveProperty('qrCode');
  });

  it('an invalid QR payload is never shown', async () => {
    mp.tamperCreate = (p) =>
      void (p.point_of_interaction.transaction_data.qr_code_base64 = 'PHN2Zz48L3N2Zz4=');
    const movie = await liveMovie();
    expect((await sponsor(movieBody(movie.id, legal))).res.status).toBe(503);
  });
});

describe('vouchers (guests included)', () => {
  async function voucher(over: Record<string, unknown> = {}) {
    return db().voucher.create({
      data: {
        code: `CUPOM-${randomUUID().slice(0, 8).toUpperCase()}`,
        kind: 'PERCENT',
        percentBps: 1000,
        ...over,
      },
    });
  }

  it('applies, reserves a redemption, and counts per buyer', async () => {
    const v = await voucher({ maxRedemptions: 1 });
    const m1 = await liveMovie(100);
    const r = await sponsor(
      movieBody(m1.id, legal, { voucherCode: v.code.toLowerCase(), expectedTotalCents: 1800 }),
    );
    expect(r.res.status).toBe(201);
    const o = await orderByCode(r.json.publicCode as string);
    expect(o.voucherRedemption).toMatchObject({
      status: 'RESERVED',
      discountCents: 200,
      userId: null,
      buyerKey: o.buyerKey,
    });
    expect((await db().voucher.findUniqueOrThrow({ where: { id: v.id } })).redemptionCount).toBe(1);
    const m2 = await liveMovie(100);
    const soldOut = await sponsor(
      movieBody(m2.id, legal, { voucherCode: v.code, expectedTotalCents: 1800 }),
    );
    expect(soldOut.json.code).toBe('VOUCHER_SOLD_OUT');
  });

  it('5 invalid codes → 15-minute cool-down (04 §6)', async () => {
    const ip = freshIp();
    const movie = await liveMovie(100);
    for (let i = 0; i < 5; i++) {
      const r = await sponsor(movieBody(movie.id, legal, { voucherCode: `NADA-${i}-XXXXXX` }), {
        ip,
      });
      expect(r.json.code).toBe('VOUCHER_INVALID');
    }
    const r = await sponsor(movieBody(movie.id, legal, { voucherCode: 'NADA-9-XXXXXX' }), { ip });
    expect(r.res.status).toBe(429);
    expect(r.json.code).toBe('VOUCHER_COOLDOWN');
  });

  it('concurrent use of a 3-use voucher by 10 buyers: never more than 3', async () => {
    const v = await voucher({ maxRedemptions: 3 });
    const movies = await liveMovies(10, 100);
    const results = await Promise.all(
      movies.map((m) =>
        sponsor(movieBody(m.id, legal, { voucherCode: v.code, expectedTotalCents: 1800 }), {
          ip: freshIp(),
        }),
      ),
    );
    expect(results.filter((r) => r.res.status === 201)).toHaveLength(3);
    expect((await db().voucher.findUniqueOrThrow({ where: { id: v.id } })).redemptionCount).toBe(3);
  });
});

describe('queue jump caps (04 §5)', () => {
  it('"Topo da fila" is sold once per day even under 10 parallel buyers', async () => {
    await db().queueJumpSlot.deleteMany({});
    const movies = await liveMovies(10, 100);
    const results = await Promise.all(
      movies.map((m) =>
        sponsor(movieBody(m.id, legal, { queueJumpTier: 'topo', expectedTotalCents: 5200 }), {
          ip: freshIp(),
        }),
      ),
    );
    expect(results.filter((r) => r.res.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.json.code === 'QUEUE_JUMP_SOLD_OUT')).toHaveLength(9);
    const slots = await db().queueJumpSlot.findMany({});
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      tierId: 'topo',
      dayIndex: 0,
      weekIndex: 0,
      multiplierBps: 16000,
      confirmed: false,
    });
  });

  it('shared daily cap of 5 across tiers', async () => {
    await db().queueJumpSlot.deleteMany({});
    const movies = await liveMovies(8, 100);
    const results = await Promise.all(
      movies.map((m) =>
        sponsor(movieBody(m.id, legal, { queueJumpTier: 'prioridade', expectedTotalCents: 3600 }), {
          ip: freshIp(),
        }),
      ),
    );
    expect(results.filter((r) => r.res.status === 201)).toHaveLength(5);
    const idx = (await db().queueJumpSlot.findMany({})).map((s) => s.dayIndex).sort();
    expect(idx).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('campaign contributions — no overfunding (11 §2.2)', () => {
  it('validates the amount', async () => {
    const { campaign } = await openCampaignFor(10_000);
    for (const amount of [499, 550, 0]) {
      const r = await contribute(campaign.id, contributionBody(amount, legal));
      expect([422]).toContain(r.res.status);
    }
    const over = await contribute(campaign.id, contributionBody(20_000, legal));
    expect(over.res.status).toBe(409);
    expect(over.json).toMatchObject({ code: 'AMOUNT_ABOVE_REMAINING', remainingCents: '10000' });
  });

  it('30 parallel R$ 10 contributions into R$ 100: exactly 10 reserve; approvals fund the campaign', async () => {
    const { campaign, item } = await openCampaignFor(10_000);
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        contribute(campaign.id, contributionBody(1000, legal), { ip: freshIp() }),
      ),
    );
    const ok = results.filter((r) => r.res.status === 201);
    expect(ok).toHaveLength(10);
    expect(
      results
        .filter((r) => r.res.status === 409)
        .every((r) => r.json.code === 'AMOUNT_ABOVE_REMAINING'),
    ).toBe(true);
    let c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({ remainingCents: 0, reservedCents: 10_000, raisedCents: 0 });

    for (const r of ok) {
      const o = await orderByCode(r.json.publicCode as string);
      expect(o).toMatchObject({
        kind: 'CONTRIBUTION',
        campaignId: campaign.id,
        totalCents: 1000,
        ruleSetId: null,
      });
      mp.approve(Number(o.payment!.providerPaymentId));
      expect(await syncPayment(o.payment!.providerPaymentId!)).toBe('applied');
    }
    c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({
      raisedCents: 10_000,
      reservedCents: 0,
      remainingCents: 0,
      supporterCount: 10,
      status: 'FUNDED',
    });
    expect(c.fundedAt).not.toBeNull();
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'FUNDED',
    );
    const closed = await contribute(campaign.id, contributionBody(500, legal));
    expect(closed.json.code).toBe('CAMPAIGN_CLOSED');
  });

  it('a paused campaign (deadline passed) takes nothing', async () => {
    const { campaign } = await openCampaignFor(10_000);
    await db().campaign.update({
      where: { id: campaign.id },
      data: {
        openedAt: new Date(Date.now() - 2 * 86_400_000),
        deadlineAt: new Date(Date.now() - 1000),
      },
    });
    const r = await contribute(campaign.id, contributionBody(500, legal));
    expect(r.res.status).toBe(409);
    expect(r.json.code).toBe('CAMPAIGN_CLOSED');
  });

  it('a contribution has no perk, voucher or queue jump fields', async () => {
    const { campaign } = await openCampaignFor(10_000);
    const r = await contribute(
      campaign.id,
      contributionBody(500, legal, { voucherCode: 'CUPOM-ABCDEFGH' }),
    );
    expect(r.res.status).toBe(422);
  });
});

describe('rule set', () => {
  it('fails closed when the active rule set is tampered with', async () => {
    const rs = await db().priceRuleSet.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    const orig = rs.config;
    await db().priceRuleSet.update({
      where: { id: rs.id },
      data: { config: { ...(orig as object), minTotalCents: 100 } },
    });
    resetRuleSetCache();
    try {
      const movie = await liveMovie();
      const r = await sponsor(movieBody(movie.id, legal));
      expect(r.json).toMatchObject({ code: 'SPONSORSHIPS_CLOSED', reason: 'NO_PRICES' });
    } finally {
      await db().priceRuleSet.update({ where: { id: rs.id }, data: { config: orig as object } });
      resetRuleSetCache();
    }
  });
});
