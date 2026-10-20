/**
 * The worker wiring (13 §3 step 1): real BullMQ queues on the test Redis, the same processors
 * the worker process runs. A signed notification goes in through the route; the order comes out
 * PAID and its receipt is sent — no direct calls to the services in between.
 */
import { randomUUID } from 'node:crypto';
import { QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import * as orders from '@/app/api/v1/orders/route';
import * as webhook from '@/app/api/webhooks/mercadopago/route';
import { db } from '@/server/db';
import { devOutbox } from '@/server/email/transport';
import { getEnv } from '@/server/env';
import { closeQueues, emailQueue, paymentsQueue, QUEUE } from '@/server/jobs/queues';
import { processEmail, processPayments } from '@/worker/processors';
import { clearCatalog, makeItem } from '../support/catalog';
import { call, freshIp, req } from '../support/http';
import { checkoutHeaders, installPaymentsMock, LEGAL, signedWebhook } from '../support/payments';

const mock = installPaymentsMock();
let workers: Worker[] = [];

beforeAll(async () => {
  // Earlier suites leave jobs behind (they enqueue but run no worker): start from empty queues.
  await paymentsQueue().obliterate({ force: true });
  await emailQueue().obliterate({ force: true });
  const conn = () => new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
  workers = [
    new Worker(QUEUE.payments, processPayments, { connection: conn(), concurrency: 2 }),
    new Worker(QUEUE.email, processEmail, { connection: conn(), concurrency: 1 }),
  ];
});

beforeEach(async () => {
  await clearCatalog();
});

afterAll(async () => {
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
});

async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

it('webhook → queue → worker: the order is paid, the movie sponsored, the receipt sent', async () => {
  const movie = await makeItem({ status: 'ACTIVE', slot: 1 });
  const res = await call(
    orders.POST,
    req('POST', '/api/v1/orders', {
      body: {
        itemId: movie.id,
        expectedTotalCents: 2000,
        contactEmail: `w-${randomUUID().slice(0, 8)}@example.com`,
        legal: LEGAL,
      },
      headers: checkoutHeaders(),
      ip: freshIp(),
    }),
  );
  expect(res.status).toBe(201);
  const { order } = (await res.json()) as { order: { id: string; publicCode: string } };
  const mp = mock.orderFor(order.id)!;
  mock.approve(mp.id);

  const h = signedWebhook(mp.id);
  const hook = await call(webhook.POST, req('POST', h.url, { body: h.body, headers: h.headers }));
  expect(hook.status).toBe(200);

  await until(
    async () => (await db().order.findUnique({ where: { id: order.id } }))?.status === 'PAID',
  );
  expect((await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).status).toBe(
    'SPONSORED',
  );
  await until(
    async () =>
      (await db().webhookEvent.findUnique({ where: { requestId: h.requestId } }))?.outcome ===
      'PROCESSED',
  );
  await until(async () => devOutbox().some((m) => m.subject.includes(order.publicCode)));
  const receipt = await db().emailOutbox.findFirstOrThrow({ where: { orderId: order.id } });
  expect(receipt.status).toBe('SENT');
});

it('schedulers can be registered (idempotent upsert)', async () => {
  const p = paymentsQueue();
  await p.upsertJobScheduler('test-expire', { every: 60_000 }, { name: 'orders.expire', data: {} });
  await p.upsertJobScheduler('test-expire', { every: 60_000 }, { name: 'orders.expire', data: {} });
  const schedulers = await p.getJobSchedulers();
  expect(schedulers.filter((s) => s.key === 'test-expire')).toHaveLength(1);
  await p.removeJobScheduler('test-expire');
  const events = new QueueEvents(QUEUE.email, {
    connection: new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null }),
  });
  await events.waitUntilReady();
  const job = await emailQueue().add('email.sweep', {});
  expect(await job.waitUntilFinished(events, 10_000)).toBe(0);
  await events.close();
});
