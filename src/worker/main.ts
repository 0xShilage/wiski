/**
 * The worker process (`npm run worker`; Docker: same image, `node` on this entry). Consumes the
 * BullMQ queues the web process fills and runs the periodic sweeps:
 *
 *   payments   payment.sync · payment.recover · payment.cancel
 *              payment.reconcile (every 2 min; nightly 48 h sweep at 03:00 São Paulo)
 *              orders.expire (every minute)
 *   email      email.send · email.sweep (every minute)
 *
 * Refuses to start with an invalid environment, like the web process.
 */
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { disconnectDb } from '@/server/db';
import { EnvError, getEnv } from '@/server/env';
import { closeQueues, emailQueue, paymentsQueue, QUEUE } from '@/server/jobs/queues';
import { logger } from '@/server/log';
import { disconnectRedis } from '@/server/redis';
import { processEmail, processPayments } from './processors';

try {
  getEnv();
} catch (error) {
  if (error instanceof EnvError) {
    console.error(`[wiskiflix-worker] refusing to start.\n${error.message}`);
    process.exit(1);
  }
  throw error;
}

const connection = () => new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });

const workers = [
  new Worker(QUEUE.payments, processPayments, { connection: connection(), concurrency: 4 }),
  new Worker(QUEUE.email, processEmail, { connection: connection(), concurrency: 2 }),
];

for (const w of workers) {
  w.on('failed', (job, err) =>
    logger.warn(
      {
        queue: w.name,
        job: job?.name,
        attempts: job?.attemptsMade,
        err: err.message.slice(0, 200),
      },
      'job failed',
    ),
  );
  w.on('error', (err) => logger.error({ queue: w.name, err: err.message }, 'worker error'));
}

async function schedule(): Promise<void> {
  const p = paymentsQueue();
  await p.upsertJobScheduler(
    'reconcile-recent',
    { every: 120_000 },
    { name: 'payment.reconcile', data: { sweep: 'recent' } },
  );
  await p.upsertJobScheduler(
    'reconcile-nightly',
    { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' },
    { name: 'payment.reconcile', data: { sweep: 'nightly' } },
  );
  await p.upsertJobScheduler(
    'orders-expire',
    { every: 60_000 },
    { name: 'orders.expire', data: {} },
  );
  await emailQueue().upsertJobScheduler(
    'email-sweep',
    { every: 60_000 },
    { name: 'email.sweep', data: {} },
  );
}

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'worker stopping');
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([closeQueues(), disconnectDb(), disconnectRedis()]);
  process.exit(0);
}
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));

await schedule();
logger.info({ queues: workers.map((w) => w.name) }, 'worker started');
