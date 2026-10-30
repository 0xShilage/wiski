/**
 * Guest-token and order-access tests (Phase 2 exit criteria; 05 §5 "guest checkout"): the public
 * code alone grants nothing; the order-link token is exchanged once for the sealed order cookie;
 * claiming needs login AND the cookie; guest cancel needs the cookie-bound CSRF token; moderators
 * can read but not act; SSE streams answer only to those who may read the order.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as access } from '@/app/api/v1/orders/[code]/access/route';
import { POST as cancel } from '@/app/api/v1/orders/[code]/cancel/route';
import { POST as claim } from '@/app/api/v1/orders/[code]/claim/route';
import { GET as events } from '@/app/api/v1/orders/[code]/events/route';
import { GET as myOrders } from '@/app/api/v1/me/orders/route';
import { GET as legalCurrent } from '@/app/api/v1/legal/current/route';
import { db } from '@/server/db';
import { syncPayment } from '@/server/payments/sync';
import { clearCatalog } from '../support/catalog';
import {
  getOrder,
  type Legal,
  liveMovie,
  movieBody,
  orderByCode,
  orderCookie,
  sponsor,
} from '../support/checkout';
import { makeUser } from '../support/db';
import { call, freshIp, req, setCookies, signedIn } from '../support/http';
import { ensureLegal, type FakeMp, installFakeMp } from '../support/mercadopago';

let legal: Legal;
let mp: FakeMp;

beforeAll(async () => {
  legal = await ensureLegal();
});
beforeEach(async () => {
  mp = installFakeMp();
  await clearCatalog();
});

async function guestOrder() {
  const movie = await liveMovie();
  const r = await sponsor(movieBody(movie.id, legal));
  expect(r.res.status).toBe(201);
  return {
    code: r.json.publicCode as string,
    token: r.json.accessToken as string,
    cookie: orderCookie(r.cookies),
    movie,
  };
}

const post = (handler: typeof access, code: string, init: Parameters<typeof req>[2] = {}) =>
  call(handler as never, req('POST', `/api/v1/orders/${code}/x`, init), { code });

describe('who can read an order', () => {
  it('the public code alone → 404; a forged or foreign cookie → 404', async () => {
    const a = await guestOrder();
    const b = await guestOrder();
    expect((await getOrder(a.code)).res.status).toBe(404);
    expect((await getOrder(a.code, { cookies: b.cookie })).res.status).toBe(404);
    expect(
      (await getOrder(a.code, { cookies: { '__Host-wf_order': 'v1.abcd.garbage' } })).res.status,
    ).toBe(404);
    expect((await getOrder(a.code, { cookies: a.cookie })).res.status).toBe(200);
    expect((await getOrder('WF-ZZZZZZ', { cookies: a.cookie })).res.status).toBe(404);
    expect((await getOrder('not-a-code', { cookies: a.cookie })).res.status).toBe(404);
  });

  it('moderators can read (staff), but not cancel', async () => {
    const a = await guestOrder();
    const mod = await signedIn(await makeUser({ role: 'MODERATOR' }));
    const r = await getOrder(a.code, mod);
    expect(r.res.status).toBe(200);
    expect(r.json).toMatchObject({ canCancel: false, canClaim: false, orderCsrf: null });
    expect((await post(cancel, a.code, mod)).status).toBe(404);
  });
});

describe('order-link token exchange', () => {
  it('right token → the order joins this browser cookie (which keeps other orders)', async () => {
    const a = await guestOrder();
    const b = await guestOrder();
    const res = await post(access, a.code, { body: { token: a.token }, cookies: b.cookie });
    expect(res.status).toBe(200);
    const cookie = { '__Host-wf_order': setCookies(res)['__Host-wf_order']!.value };
    expect((await getOrder(a.code, { cookies: cookie })).res.status).toBe(200);
    expect((await getOrder(b.code, { cookies: cookie })).res.status).toBe(200);
  });

  it('wrong token and unknown code answer the same 404 (no oracle)', async () => {
    const a = await guestOrder();
    const wrong = await post(access, a.code, { body: { token: 'A'.repeat(43) } });
    const unknown = await post(access, 'WF-ZZZZZZ', { body: { token: a.token } });
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await wrong.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect(setCookies(wrong)['__Host-wf_order']).toBeUndefined();
  });

  it('is rate-limited (10/min per IP)', async () => {
    const a = await guestOrder();
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await post(access, a.code, { body: { token: 'B'.repeat(43) }, ip })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('only the token hash is stored', async () => {
    const a = await guestOrder();
    const row = await orderByCode(a.code);
    expect(Buffer.from(row.accessTokenHash).toString('base64url')).not.toContain(a.token);
    expect(JSON.stringify(row)).not.toContain(a.token);
  });
});

describe('claim (attach a guest order to an account)', () => {
  it('needs login AND the order cookie; then the order is mine', async () => {
    const a = await guestOrder();
    const user = await makeUser();
    const auth = await signedIn(user);
    expect((await post(claim, a.code, auth)).status).toBe(404); // no cookie
    expect((await post(claim, a.code, { cookies: a.cookie })).status).toBe(401); // no login
    const ok = await post(claim, a.code, {
      ...auth,
      cookies: { ...auth.cookies, ...a.cookie },
    });
    expect(ok.status).toBe(200);
    const row = await orderByCode(a.code);
    expect(row.userId).toBe(user.id);
    expect(row.claimedAt).not.toBeNull();
    const mine = await call(myOrders, req('GET', '/api/v1/me/orders', auth));
    expect(
      ((await mine.json()) as { orders: { code: string }[] }).orders.map((o) => o.code),
    ).toContain(a.code);
    // once claimed, nobody else can claim it, and the owner sees it without the cookie
    const other = await signedIn(await makeUser());
    const again = await post(claim, a.code, {
      ...other,
      cookies: { ...other.cookies, ...a.cookie },
    });
    expect(again.status).toBe(409);
    expect((await getOrder(a.code, auth)).res.status).toBe(200);
    const audit = await db().auditLog.findFirst({
      where: { action: 'order.claim', targetId: row.id },
    });
    expect(audit?.actorId).toBe(user.id);
  });
});

describe('cancel an unpaid order', () => {
  it('guests need the cookie-bound CSRF token', async () => {
    const a = await guestOrder();
    expect((await post(cancel, a.code, { cookies: a.cookie })).status).toBe(403);
    const view = await getOrder(a.code, { cookies: a.cookie });
    const token = view.json.orderCsrf as string;
    expect(token).toBeTruthy();
    const other = await guestOrder();
    // a token from another browser's cookie doesn't work
    const otherToken = (await getOrder(other.code, { cookies: other.cookie })).json
      .orderCsrf as string;
    expect(
      (await post(cancel, a.code, { cookies: a.cookie, headers: { 'x-csrf-token': otherToken } }))
        .status,
    ).toBe(403);
    const ok = await post(cancel, a.code, {
      cookies: a.cookie,
      headers: { 'x-csrf-token': token },
    });
    expect(ok.status).toBe(200);
    const row = await orderByCode(a.code);
    expect(row.status).toBe('CANCELLED');
    expect(row.item.reservedOrderId).toBeNull();
    expect(mp.forOrder(row.id).status).toBe('cancelled');
    // and the movie is for sale again
    expect((await sponsor(movieBody(a.movie.id, legal))).res.status).toBe(201);
  });

  it('a cross-site request is refused before anything else', async () => {
    const a = await guestOrder();
    const res = await post(cancel, a.code, {
      cookies: a.cookie,
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.status).toBe(403);
  });

  it('a Pix paid in the meantime cannot be cancelled → 409, order PAID', async () => {
    const a = await guestOrder();
    const row = await orderByCode(a.code);
    mp.approve(Number(row.payment!.providerPaymentId));
    const token = (await getOrder(a.code, { cookies: a.cookie })).json.orderCsrf as string;
    const res = await post(cancel, a.code, {
      cookies: a.cookie,
      headers: { 'x-csrf-token': token },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('ORDER_ALREADY_PAID');
    expect((await orderByCode(a.code)).status).toBe('PAID');
  });

  it('paid orders are not cancellable', async () => {
    const a = await guestOrder();
    const row = await orderByCode(a.code);
    mp.approve(Number(row.payment!.providerPaymentId));
    await syncPayment(row.payment!.providerPaymentId!);
    const token = (await getOrder(a.code, { cookies: a.cookie })).json.orderCsrf as string;
    const res = await post(cancel, a.code, {
      cookies: a.cookie,
      headers: { 'x-csrf-token': token },
    });
    expect(res.status).toBe(409);
  });
});

describe('SSE order events', () => {
  it('streams the current status first, only to readers of the order', async () => {
    const a = await guestOrder();
    const ac = new AbortController();
    const res = await call(
      events,
      new (await import('next/server')).NextRequest(
        new URL(`/api/v1/orders/${a.code}/events`, 'http://localhost:3000'),
        {
          headers: {
            cookie: `__Host-wf_order=${a.cookie['__Host-wf_order']}`,
            'x-real-ip': freshIp(),
          },
          signal: ac.signal,
        },
      ),
      { code: a.code },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('PENDING_PAYMENT')) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
    }
    expect(text).toContain('retry: 3000');
    expect(text).not.toContain('@'); // no e-mail or personal data in events
    ac.abort();
    await reader.cancel();
    const denied = await call(events, req('GET', `/api/v1/orders/${a.code}/events`), {
      code: a.code,
    });
    expect(denied.status).toBe(404);
  });
});

describe('legal versions', () => {
  it('GET /api/v1/legal/current lists what checkout expects', async () => {
    const res = await call(legalCurrent, req('GET', '/api/v1/legal/current'));
    expect(await res.json()).toEqual({ legal });
    void randomUUID;
  });
});
