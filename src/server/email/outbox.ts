import 'server-only';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@/generated/prisma/client';
import { KIND_PATH } from '@/lib/catalog/kinds';
import { db } from '../db';
import { getEnv } from '../env';
import { enqueue } from '../jobs/queues';
import { logger } from '../log';
import { seal, unseal } from '../security/crypto';
import { render } from './templates';
import { EmailSendError, sendEmail } from './transport';

/**
 * Transactional outbox (13 §3 step 10). Rows are written inside the transaction of the event
 * that causes them (checkout → HELD receipt; approval → PENDING; campaign funded/extended →
 * notices), and the worker sends them. Idempotent: one row per dedupeKey, Resend gets the row id
 * as Idempotency-Key, and a SENT row is never sent again.
 */
type Tx = Prisma.TransactionClient;
const TOKEN_PURPOSE = 'receipt-order-token';
const TOKEN_TTL_MS = 3 * 86_400_000;
const MAX_ATTEMPTS = 8;
const LEASE_MS = 5 * 60_000;

const sealKeys = () => {
  const env = getEnv();
  return { current: env.COOKIE_SEAL_KEY, previous: env.COOKIE_SEAL_KEY_PREVIOUS };
};

/** Checkout: the receipt waits (HELD) for the approval, carrying the sealed order-link token. */
export async function holdReceiptInTx(tx: Tx, orderId: string, accessToken: string): Promise<void> {
  await tx.emailOutbox.create({
    data: {
      template: 'ORDER_RECEIPT',
      orderId,
      dedupeKey: `receipt:${orderId}`,
      status: 'HELD',
      sealedToken: seal({ t: accessToken }, sealKeys(), TOKEN_PURPOSE, TOKEN_TTL_MS),
    },
  });
}

/** One notice per contributor (latest paid contribution of each buyer). */
async function contributorsOf(tx: Tx | ReturnType<typeof db>, campaignId: string) {
  const paid = await tx.order.findMany({
    where: {
      campaignId,
      kind: 'CONTRIBUTION',
      status: { in: ['PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED'] },
    },
    select: { id: true, buyerKey: true },
    orderBy: { createdAt: 'desc' },
  });
  const seen = new Set<string>();
  return paid.filter((o) => (seen.has(o.buyerKey) ? false : (seen.add(o.buyerKey), true)));
}

export async function queueFundedNotices(tx: Tx, campaignId: string): Promise<void> {
  const rows = await contributorsOf(tx, campaignId);
  if (!rows.length) return;
  await tx.emailOutbox.createMany({
    data: rows.map((o) => ({
      template: 'CAMPAIGN_FUNDED' as const,
      orderId: o.id,
      campaignId,
      dedupeKey: `funded:${campaignId}:${o.id}`,
    })),
    skipDuplicates: true,
  });
}

/** After the STREAMER extends a campaign (11 §2.2: contributors with an e-mail get a notice). */
export async function queueExtensionNotices(
  campaignId: string,
  extensions: number,
): Promise<number> {
  const rows = await contributorsOf(db(), campaignId);
  if (!rows.length) return 0;
  const res = await db().emailOutbox.createMany({
    data: rows.map((o) => ({
      template: 'CAMPAIGN_EXTENDED' as const,
      orderId: o.id,
      campaignId,
      dedupeKey: `extended:${campaignId}:${extensions}:${o.id}`,
    })),
    skipDuplicates: true,
  });
  const ready = await db().emailOutbox.findMany({
    where: { campaignId, template: 'CAMPAIGN_EXTENDED', status: 'PENDING' },
    select: { id: true },
  });
  for (const r of ready) await enqueue.email(r.id);
  return res.count;
}

function backoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

/** Development only: keep a copy under .tmp/emails so the order link can be opened locally. */
function devCopy(subject: string, text: string): void {
  if (getEnv().NODE_ENV !== 'development') return;
  try {
    const dir = join(process.cwd(), '.tmp', 'emails');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${Date.now()}.txt`), `Subject: ${subject}\n\n${text}\n`, {
      mode: 0o600,
    });
  } catch {
    // best effort
  }
}

/** email.send — returns what happened (for logs/tests). */
export async function sendOutbox(
  id: string,
  now = new Date(),
): Promise<'sent' | 'skipped' | 'retry' | 'failed'> {
  const row = await db().emailOutbox.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true,
          publicCode: true,
          kind: true,
          contactEmail: true,
          totalCents: true,
          item: {
            select: {
              title: true,
              slug: true,
              kind: true,
              campaign: { select: { deadlineAt: true } },
            },
          },
        },
      },
    },
  });
  if (!row || row.status !== 'PENDING' || row.nextAttemptAt > now) return 'skipped';
  // Lease: exactly one worker sends this row; a crash makes it due again after 5 minutes.
  const claimed = await db().emailOutbox.updateMany({
    where: { id, status: 'PENDING', nextAttemptAt: row.nextAttemptAt },
    data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count !== 1) return 'skipped';
  const env = getEnv();
  const o = row.order;
  let orderUrl: string | null = null;
  if (row.template === 'ORDER_RECEIPT' && row.sealedToken) {
    const t = unseal<{ t?: unknown }>(row.sealedToken, sealKeys(), TOKEN_PURPOSE)?.t;
    if (typeof t === 'string') orderUrl = `${env.APP_ORIGIN}/pedido/${o.publicCode}#t=${t}`;
  }
  const content = render(row.template, {
    origin: env.APP_ORIGIN,
    publicCode: o.publicCode,
    kind: o.kind,
    title: o.item.title,
    totalCents: o.totalCents,
    orderUrl,
    itemUrl: `${env.APP_ORIGIN}/${KIND_PATH[o.item.kind]}/${o.item.slug}`,
    deadlineAt: o.item.campaign?.deadlineAt,
  });
  try {
    const res = await sendEmail({ ...content, to: o.contactEmail, idempotencyKey: row.id });
    await db().emailOutbox.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'SENT',
        sentAt: now,
        sealedToken: null,
        attempts: { increment: 1 },
        providerMessageId: res.providerMessageId,
        lastError: null,
      },
    });
    devCopy(content.subject, content.text);
    return 'sent';
  } catch (err) {
    const code =
      err instanceof EmailSendError ? `${err.code}${err.status ? `-${err.status}` : ''}` : 'error';
    const attempts = row.attempts + 1;
    const final =
      attempts >= MAX_ATTEMPTS || (err instanceof EmailSendError && err.code === 'rejected');
    await db().emailOutbox.updateMany({
      where: { id, status: 'PENDING' },
      data: final
        ? { status: 'FAILED', attempts, lastError: code.slice(0, 64), sealedToken: null }
        : {
            attempts,
            lastError: code.slice(0, 64),
            nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
          },
    });
    logger.warn({ outboxId: id, code, attempts, final }, 'e-mail not sent');
    return final ? 'failed' : 'retry';
  }
}

/** email.sweep (every minute): anything PENDING and due goes (back) to the queue. */
export async function sweepOutbox(now = new Date()): Promise<number> {
  const due = await db().emailOutbox.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    select: { id: true },
    take: 200,
    orderBy: { nextAttemptAt: 'asc' },
  });
  for (const r of due) await enqueue.email(r.id);
  return due.length;
}
