/**
 * The worker process (01 §2): `npm run worker` next to `npm run dev`, a second container in
 * production. It serves no HTTP. Jobs are plain functions over Postgres (the durable queue is the
 * WebhookEvent table), scheduled here with timers; every job is idempotent, so a crash or a second
 * worker is harmless. A Redis message ("wf:jobs") wakes the webhook loop immediately.
 */
import { closeSync, openSync, utimesSync } from 'node:fs';
import Redis from 'ioredis';
import { getEnv } from '@/server/env';
import { logger } from '@/server/log';
import {
  expireOrders,
  processWebhookEvents,
  purgeWebhookEvents,
  reconcileEveryMs,
  reconcilePending,
  sweepRecent,
} from '@/server/payments/jobs';
import { closeRealtime } from '@/server/realtime/events';
import { disconnectDb } from '@/server/db';
import { disconnectRedis } from '@/server/redis';
import { purgeContact } from '@/server/contact/contact';
import { purgeSuggestions } from '@/server/suggestions/suggestions';
import { publishLegal } from '@/server/legal/publish';
import { runAuditVerify } from './jobs/audit-verify';
import { WAKE_CHANNEL } from '@/server/payments/wake';

type Job = {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
  running?: boolean;
  last?: number;
};

const BRT_OFFSET_MS = 3 * 3_600_000;
/** true once per America/Sao_Paulo day, at or after hh:mm */
function dailyAt(hh: number, mm: number) {
  let lastDay = '';
  return (now: Date) => {
    const local = new Date(now.getTime() - BRT_OFFSET_MS);
    const day = local.toISOString().slice(0, 10);
    const due = local.getUTCHours() * 60 + local.getUTCMinutes() >= hh * 60 + mm;
    if (due && day !== lastDay) {
      lastDay = day;
      return true;
    }
    return false;
  };
}

const auditDue = dailyAt(3, 30);
const sweepDue = dailyAt(4, 0);

const jobs: Job[] = [
  { name: 'webhook.events', everyMs: 2_000, run: () => processWebhookEvents() },
  { name: 'orders.expire', everyMs: 60_000, run: () => expireOrders() },
  { name: 'payment.reconcile', everyMs: reconcileEveryMs(), run: () => reconcilePending() },
  {
    name: 'daily',
    everyMs: 60_000,
    run: async () => {
      const now = new Date();
      if (auditDue(now)) await runAuditVerify();
      if (sweepDue(now)) {
        await sweepRecent(now);
        await purgeWebhookEvents(now);
        await purgeContact(now); // LGPD: contact messages after 12 months (Phase 4)
        await purgeSuggestions(now); // LGPD: decided suggestions after 12 months (Phase 6)
      }
    },
  },
];

/**
 * Liveness for the container healthcheck (docker/compose.prod.yml): touch HEARTBEAT after every
 * job round (failed or not), at most every 10 s. Best effort: a read-only or missing /tmp never stops a job.
 */
const HEARTBEAT = '/tmp/wf-worker-alive';
let lastBeat = 0;
function heartbeat() {
  const now = Date.now();
  if (now - lastBeat < 10_000) return;
  lastBeat = now;
  try {
    closeSync(openSync(HEARTBEAT, 'a'));
    utimesSync(HEARTBEAT, now / 1000, now / 1000);
  } catch {
    /* development on a read-only /tmp, or no /tmp: nothing to report to */
  }
}

async function tick(job: Job) {
  if (job.running) return;
  job.running = true;
  try {
    await job.run();
  } catch (err) {
    logger.error(
      { job: job.name, err: err instanceof Error ? err.message : 'unknown' },
      'job failed',
    );
  } finally {
    job.running = false;
    job.last = Date.now();
    heartbeat(); // alive even when a job fails (e.g. Mercado Pago down): the loop is what counts
  }
}

async function main() {
  getEnv(); // refuse to start on a bad environment
  logger.info({ jobs: jobs.map((j) => j.name) }, 'worker started');
  const timers = jobs.map((j) => {
    void tick(j);
    return setInterval(() => void tick(j), j.everyMs);
  });

  const sub = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
  sub.on('error', (err) => logger.warn({ err: err.message }, 'worker wake subscriber error'));
  await sub.subscribe(WAKE_CHANNEL).catch(() => {});
  sub.on('message', () => void tick(jobs[0]!));

  const stop = async (signal: string) => {
    logger.info({ signal }, 'worker stopping');
    timers.forEach(clearInterval);
    sub.disconnect();
    for (let i = 0; i < 50 && jobs.some((j) => j.running); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await closeRealtime();
    await disconnectRedis();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

/**
 * `node dist/worker.mjs --verify-audit` (Phase 5): check the audit hash chain once and exit 0/1 —
 * used by the restore drill (scripts/ops/restore.sh) against a restored database.
 */
async function verifyOnce() {
  getEnv();
  const ok = await runAuditVerify();
  await disconnectRedis();
  await disconnectDb();
  process.exit(ok ? 0 : 1);
}

/**
 * `node --conditions=react-server dist/worker.mjs --publish-legal` (2026-11-02): register the
 * site's legal text as the current version for checkout (src/server/legal/publish.ts), once.
 */
async function publishLegalOnce() {
  getEnv();
  const r = await publishLegal();
  logger.info(r, r.published ? 'legal text published' : 'legal text already current');
  await disconnectRedis();
  await disconnectDb();
  process.exit(0);
}

void (
  process.argv.includes('--verify-audit')
    ? verifyOnce()
    : process.argv.includes('--publish-legal')
      ? publishLegalOnce()
      : main()
).catch((err: unknown) => {
  logger.fatal({ err: err instanceof Error ? err.message : 'unknown' }, 'worker crashed');
  process.exit(1);
});
