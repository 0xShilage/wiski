import 'server-only';
import { Queue, type JobsOptions } from 'bullmq';
import Redis from 'ioredis';
import { getEnv } from '../env';
import { logger } from '../log';

/**
 * Background jobs (13 §3 step 1): BullMQ on the app's Redis, consumed by the worker process
 * (src/worker/main.ts — same code base, `npm run worker`). The web process only enqueues.
 *
 * Every job is idempotent: processors read the current state (from Mercado Pago or the
 * database) instead of trusting the job payload, so retries and duplicates are harmless.
 */
export const QUEUE = {
  payments: 'wf-payments',
  email: 'wf-email',
  media: 'wf-media',
} as const;

export type PaymentJob =
  | {
      name: 'payment.sync';
      data: {
        mpOrderId: string;
        source: 'webhook' | 'reconcile' | 'order';
        webhookRequestId?: string;
      };
    }
  | { name: 'payment.recover'; data: { orderId: string } }
  | { name: 'payment.cancel'; data: { orderId: string } }
  | { name: 'payment.reconcile'; data: { sweep: 'recent' | 'nightly' } }
  | { name: 'orders.expire'; data: Record<string, never> };

export type EmailJob =
  | { name: 'email.send'; data: { outboxId: string } }
  | { name: 'email.sweep'; data: Record<string, never> };

const globalForJobs = globalThis as unknown as {
  __wfQueues?: Map<string, Queue> | undefined;
  __wfQueueRedis?: Redis | undefined;
};

/** BullMQ needs its own connection with maxRetriesPerRequest: null (blocking commands). */
export function bullConnection(): Redis {
  globalForJobs.__wfQueueRedis ??= new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  return globalForJobs.__wfQueueRedis;
}

function queue(name: string): Queue {
  globalForJobs.__wfQueues ??= new Map();
  let q = globalForJobs.__wfQueues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: bullConnection(),
      defaultJobOptions: {
        attempts: 6,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 7 * 86_400 },
      },
    });
    globalForJobs.__wfQueues.set(name, q);
  }
  return q;
}

export function paymentsQueue(): Queue {
  return queue(QUEUE.payments);
}
export function emailQueue(): Queue {
  return queue(QUEUE.email);
}
export function mediaQueue(): Queue {
  return queue(QUEUE.media);
}

/**
 * Enqueue without failing the caller: a job that can't be queued is picked up by the periodic
 * sweeps (reconcile every 2 min, expiry and e-mail every minute), so the request still succeeds.
 */
async function safeAdd(q: () => Queue, name: string, data: unknown, opts?: JobsOptions) {
  try {
    await q().add(name, data, opts);
  } catch (err) {
    logger.warn(
      { job: name, err: err instanceof Error ? err.message : 'unknown' },
      'enqueue failed',
    );
  }
}

export const enqueue = {
  paymentSync: (
    mpOrderId: string,
    source: 'webhook' | 'reconcile' | 'order',
    webhookRequestId?: string,
  ) =>
    safeAdd(paymentsQueue, 'payment.sync', {
      mpOrderId,
      source,
      ...(webhookRequestId ? { webhookRequestId } : {}),
    }),
  paymentRecover: (orderId: string) =>
    safeAdd(
      paymentsQueue,
      'payment.recover',
      { orderId },
      { jobId: `recover-${orderId}`, delay: 5_000 },
    ),
  paymentCancel: (orderId: string) =>
    safeAdd(paymentsQueue, 'payment.cancel', { orderId }, { jobId: `cancel-${orderId}` }),
  // No jobId: sendOutbox claims the row with a lease, so duplicates are harmless.
  email: (outboxId: string) => safeAdd(emailQueue, 'email.send', { outboxId }),
};

export async function closeQueues(): Promise<void> {
  for (const q of globalForJobs.__wfQueues?.values() ?? []) await q.close();
  globalForJobs.__wfQueues = undefined;
  globalForJobs.__wfQueueRedis?.disconnect();
  globalForJobs.__wfQueueRedis = undefined;
}
