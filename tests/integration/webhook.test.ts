/**
 * Mercado Pago notifications — every case of 05 §6 "Tests" against the real route handler:
 * signature, freshness, replay, duplicates, topics. The worker side is payments-sync.test.ts.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as webhook from '@/app/api/webhooks/mercadopago/route';
import { db } from '@/server/db';
import { paymentsQueue } from '@/server/jobs/queues';
import { call, req } from '../support/http';
import { signedWebhook, installPaymentsMock, WEBHOOK_SECRET } from '../support/payments';

installPaymentsMock();

beforeEach(async () => {
  await db().webhookEvent.deleteMany({});
  await paymentsQueue().obliterate({ force: true });
});

const MP_ID = 'ORD01JABCDEF0123456789XYZWVQ';
type Hook = ReturnType<typeof signedWebhook>;
const deliver = (h: { url: string; body: unknown; headers: Record<string, string> }) =>
  call(
    webhook.POST,
    req('POST', h.url, {
      body: h.body,
      headers: { ...h.headers, origin: null, 'sec-fetch-site': null },
    }),
  );

async function queued(): Promise<{ name: string; data: Record<string, unknown> }[]> {
  const jobs = await paymentsQueue().getJobs(['waiting', 'delayed', 'prioritized']);
  return jobs.map((j) => ({ name: j.name, data: j.data as Record<string, unknown> }));
}

describe('signature (05 §6 steps 2–4)', () => {
  it('a correctly signed delivery is recorded and queues payment.sync — fast', async () => {
    const h = signedWebhook(MP_ID);
    const t0 = performance.now();
    const res = await deliver(h);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'RECEIVED' });
    const ev = await db().webhookEvent.findUniqueOrThrow({ where: { requestId: h.requestId } });
    expect(ev).toMatchObject({ topic: 'order', resourceId: MP_ID, outcome: 'RECEIVED' });
    expect(await queued()).toEqual([
      {
        name: 'payment.sync',
        data: { mpOrderId: MP_ID, source: 'webhook', webhookRequestId: h.requestId },
      },
    ]);
  });

  it.each([
    ['wrong secret', () => signedWebhook(MP_ID, { secret: 'not-the-secret-not-the-secret' })],
    [
      'id signed for another order',
      () => ({ ...signedWebhook('ORD01OTHER'), url: signedWebhook(MP_ID).url }),
    ],
  ])('%s → 401, nothing recorded or queued', async (_n, make) => {
    const res = await deliver(make());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await db().webhookEvent.count()).toBe(0);
    expect(await queued()).toEqual([]);
  });

  it.each([
    ['missing x-signature', (h: Hook) => ({ ...h, headers: { 'x-request-id': h.requestId } })],
    [
      'missing x-request-id',
      (h: Hook) => ({ ...h, headers: { 'x-signature': h.headers['x-signature'] } }),
    ],
    [
      'truncated v1',
      (h: Hook) => ({
        ...h,
        headers: { ...h.headers, 'x-signature': h.headers['x-signature'].slice(0, -2) },
      }),
    ],
    [
      'two ts parts',
      (h: Hook) => ({
        ...h,
        headers: { ...h.headers, 'x-signature': `ts=1,${h.headers['x-signature']}` },
      }),
    ],
    [
      'v1 not hex',
      (h: Hook) => ({
        ...h,
        headers: {
          ...h.headers,
          'x-signature': h.headers['x-signature'].replace(/v1=.*/, `v1=${'z'.repeat(64)}`),
        },
      }),
    ],
    [
      'request id tampered',
      (h: Hook) => ({ ...h, headers: { ...h.headers, 'x-request-id': randomUUID() } }),
    ],
  ])('%s → 401', async (_n, mutate) => {
    expect((await deliver(mutate(signedWebhook(MP_ID)))).status).toBe(401);
  });

  it('upper-case id: signed over the lower-cased id (MP rule) — and over the id as received', async () => {
    expect((await deliver(signedWebhook(MP_ID))).status).toBe(200);
    expect((await deliver(signedWebhook(MP_ID, { lowercaseId: false }))).status).toBe(200);
  });

  it('accepts the previous secret during rotation', async () => {
    process.env.MP_WEBHOOK_SECRET_PREVIOUS = WEBHOOK_SECRET;
    process.env['MP_' + 'WEBHOOK_SECRET'] = ['rotated', 'secret', 'value', 'fake', 'x'].join('-');
    const { resetEnvCache } = await import('@/server/env');
    resetEnvCache();
    try {
      expect((await deliver(signedWebhook(MP_ID))).status).toBe(200);
    } finally {
      process.env['MP_' + 'WEBHOOK_SECRET'] = WEBHOOK_SECRET;
      delete process.env.MP_WEBHOOK_SECRET_PREVIOUS;
      resetEnvCache();
    }
  });
});

describe('freshness and replay (steps 5–6)', () => {
  it.each([
    ['11 min old', Date.now() - 11 * 60_000],
    ['11 min in the future', Date.now() + 11 * 60_000],
  ])('stale ts (%s) → 401', async (_n, ts) => {
    expect((await deliver(signedWebhook(MP_ID, { ts }))).status).toBe(401);
  });

  it('ts in seconds is understood too', async () => {
    expect(
      (await deliver(signedWebhook(MP_ID, { ts: Math.floor(Date.now() / 1000) }))).status,
    ).toBe(200);
  });

  it('a replayed x-request-id → 200 DUPLICATE, queued once', async () => {
    const h = signedWebhook(MP_ID);
    expect(await (await deliver(h)).json()).toMatchObject({ outcome: 'RECEIVED' });
    expect(await (await deliver(h)).json()).toMatchObject({ outcome: 'DUPLICATE' });
    expect(await queued()).toHaveLength(1);
  });

  it('10 parallel duplicate deliveries → one event, one job', async () => {
    const h = signedWebhook(MP_ID);
    const results = await Promise.all(Array.from({ length: 10 }, () => deliver(h)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await db().webhookEvent.count()).toBe(1);
    expect(await queued()).toHaveLength(1);
  });
});

describe('envelope (step 1)', () => {
  it('other topics → 200 IGNORED, nothing queued', async () => {
    const h = signedWebhook(MP_ID);
    const res = await deliver({ ...h, url: h.url.replace('type=order', 'type=payment') });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: 'IGNORED' });
    expect(await queued()).toEqual([]);
  });

  it('only POST; bodies over 16 KB → 413; non-JSON → 415', async () => {
    const h = signedWebhook(MP_ID);
    expect((await call(webhook.POST, req('GET', h.url, { headers: h.headers }))).status).toBe(405);
    const big = await call(
      webhook.POST,
      req('POST', h.url, { headers: h.headers, body: { pad: 'x'.repeat(17_000) } }),
    );
    expect(big.status).toBe(413);
    const form = await call(
      webhook.POST,
      req('POST', h.url, {
        headers: { ...h.headers, 'content-type': 'text/plain' },
        rawBody: 'a=b',
      }),
    );
    expect(form.status).toBe(415);
  });

  it('works without Origin/Fetch-Metadata (server-to-server) and never needs a session', async () => {
    const h = signedWebhook(MP_ID);
    const res = await call(
      webhook.POST,
      req('POST', h.url, {
        body: h.body,
        headers: { ...h.headers, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('the HMAC is the documented manifest', () => {
    const ts = '1742505638683';
    const requestId = 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e';
    const v1 = createHmac('sha256', WEBHOOK_SECRET)
      .update(`id:${MP_ID.toLowerCase()};request-id:${requestId};ts:${ts};`)
      .digest('hex');
    expect(signedWebhook(MP_ID, { ts: Number(ts), requestId }).headers['x-signature']).toBe(
      `ts=${ts},v1=${v1}`,
    );
  });
});
