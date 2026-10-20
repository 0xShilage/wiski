/**
 * Realtime (13 §3 step 11): SSE for the order page (owner / order cookie) and the public campaign
 * bar. The first frame carries the current state; a sync reaches an open stream in well under a
 * second; payloads are schema-checked and public ones carry no personal data; 6 streams per IP.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as campaignEvents from '@/app/api/v1/campaigns/[id]/events/route';
import * as contributions from '@/app/api/v1/campaigns/[id]/contributions/route';
import * as orderEvents from '@/app/api/v1/orders/[code]/events/route';
import * as orders from '@/app/api/v1/orders/route';
import { COOKIE } from '@/server/auth/cookies';
import { publishCampaign, publishOrder } from '@/server/realtime/publish';
import { syncMpOrder } from '@/server/payments/sync';
import { clearCatalog, makeCampaign, makeItem } from '../support/catalog';
import { call, freshIp, req, setCookies } from '../support/http';
import { checkoutHeaders, installPaymentsMock, LEGAL } from '../support/payments';

const mock = installPaymentsMock();

beforeEach(async () => {
  await clearCatalog();
});

/** Read SSE frames until `pred` matches one (or time out). */
async function frames(
  res: Response,
  pred: (f: { event: string; data: Record<string, unknown> }[]) => boolean,
  ms = 3_000,
) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const out: { event: string; data: Record<string, unknown> }[] = [];
  const deadline = Date.now() + ms;
  try {
    while (!pred(out)) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out; frames: ${JSON.stringify(out)}`);
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), left)),
      ]);
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.+)$/m.exec(raw)?.[1];
        const data = /^data: (.+)$/m.exec(raw)?.[1];
        if (event && data) out.push({ event, data: JSON.parse(data) as Record<string, unknown> });
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out;
}

async function buyMovie() {
  const movie = await makeItem({ status: 'ACTIVE', slot: 1 });
  const res = await call(
    orders.POST,
    req('POST', '/api/v1/orders', {
      body: {
        itemId: movie.id,
        expectedTotalCents: 2000,
        contactEmail: `rt-${randomUUID().slice(0, 8)}@example.com`,
        legal: LEGAL,
      },
      headers: checkoutHeaders(),
      ip: freshIp(),
    }),
  );
  expect(res.status).toBe(201);
  const cookie = setCookies(res)[COOKIE.order]!.value;
  const { order } = (await res.json()) as { order: { id: string; publicCode: string } };
  return { order, cookie, mpId: mock.orderFor(order.id)!.id };
}

describe('order stream', () => {
  it('first frame = current status; an approval arrives in < 1 s; headers stream-friendly', async () => {
    const { order, cookie, mpId } = await buyMovie();
    const res = await call(
      orderEvents.GET,
      req('GET', `/api/v1/orders/${order.publicCode}/events`, {
        cookies: { [COOKIE.order]: cookie },
      }),
      { code: order.publicCode },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(res.headers.get('cache-control')).toContain('no-store');

    mock.approve(mpId);
    const t0 = Date.now();
    setTimeout(() => void syncMpOrder(mpId, 'webhook'), 100);
    const got = await frames(res, (f) => f.some((x) => x.data.status === 'PAID'));
    expect(Date.now() - t0).toBeLessThan(1_500); // includes the 100 ms delay before the sync
    expect(got[0]).toMatchObject({
      event: 'status',
      data: { code: order.publicCode, status: 'PENDING_PAYMENT' },
    });
    for (const f of got)
      expect(Object.keys(f.data).sort()).toEqual(['at', 'code', 'paymentStatus', 'status', 'type']);
  });

  it('no cookie, no owner → 404 (same as an unknown code)', async () => {
    const { order } = await buyMovie();
    const res = await call(
      orderEvents.GET,
      req('GET', `/api/v1/orders/${order.publicCode}/events`),
      { code: order.publicCode },
    );
    expect(res.status).toBe(404);
  });
});

describe('campaign stream', () => {
  it('public progress only — no names, no e-mails — and the bar moves on approval', async () => {
    const { campaign } = await makeCampaign({ goalCents: 5000 });
    const res = await call(
      campaignEvents.GET,
      req('GET', `/api/v1/campaigns/${campaign.id}/events`),
      { id: campaign.id },
    );
    expect(res.status).toBe(200);

    const c = await call(
      contributions.POST,
      req('POST', `/api/v1/campaigns/${campaign.id}/contributions`, {
        body: {
          amountCents: 1000,
          contactEmail: 'segredo@example.com',
          displayName: 'Nome Secreto',
          legal: LEGAL,
        },
        headers: checkoutHeaders(),
        ip: freshIp(),
      }),
      { id: campaign.id },
    );
    expect(c.status).toBe(201);
    const { order } = (await c.json()) as { order: { id: string } };
    const mpId = mock.orderFor(order.id)!.id;
    mock.approve(mpId);
    setTimeout(() => void syncMpOrder(mpId, 'webhook'), 50);
    const got = await frames(res, (f) => f.some((x) => x.data.raisedCents === 1000));
    const text = JSON.stringify(got);
    expect(text).not.toContain('segredo');
    expect(text).not.toContain('Secreto');
    for (const f of got) {
      expect(Object.keys(f.data).sort()).toEqual([
        'at',
        'goalCents',
        'raisedCents',
        'remainingCents',
        'state',
        'supporterCount',
        'type',
      ]);
    }
  });

  it('at most 6 open streams per IP; closing one frees a place', async () => {
    const { campaign } = await makeCampaign();
    const ip = freshIp();
    const open = () =>
      call(campaignEvents.GET, req('GET', `/api/v1/campaigns/${campaign.id}/events`, { ip }), {
        id: campaign.id,
      });
    const streams = await Promise.all(Array.from({ length: 6 }, open));
    expect(streams.every((s) => s.status === 200)).toBe(true);
    const seventh = await open();
    expect(seventh.status).toBe(429);
    await streams[0]!.body!.cancel();
    expect((await open()).status).toBe(200);
    await Promise.all(streams.slice(1).map((s) => s.body!.cancel()));
  });
});

describe('publish', () => {
  it('payloads are schema-checked before they reach Redis', async () => {
    await expect(
      Promise.resolve().then(() =>
        publishOrder(randomUUID(), {
          type: 'status',
          code: 'WF-ABCDEF',
          status: 'PAID',
          paymentStatus: 'APPROVED',
          at: new Date().toISOString(),
          email: 'x@example.com',
        } as never),
      ),
    ).rejects.toThrow();
    await expect(
      Promise.resolve().then(() =>
        publishCampaign(randomUUID(), {
          type: 'progress',
          goalCents: -1,
          raisedCents: 0,
          remainingCents: 0,
          supporterCount: 0,
          state: 'OPEN',
          at: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow();
  });
});
