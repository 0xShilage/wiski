import { z } from 'zod';
import { db } from '@/server/db';
import { PG, pgErrorCode } from '@/server/db-errors';
import { getEnv } from '@/server/env';
import { HttpError } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { enqueue } from '@/server/jobs/queues';
import { logger } from '@/server/log';
import { parseSignature, tsMillis, verifyNotification } from '@/server/payments/webhook';
import { RL } from '@/server/ratelimit/rules';
import { redis } from '@/server/redis';

/**
 * POST /api/webhooks/mercadopago?data.id=<MP order id>&type=order — the normative handler of
 * 05 §6, adapted to the Orders API (13 D1): verify the signature and freshness, drop replays,
 * record the delivery, queue `payment.sync` and answer fast. The body is never trusted — the
 * worker reads the order from Mercado Pago. Bad signature → 401 (no detail); duplicates and
 * other topics → 200 so Mercado Pago stops retrying.
 */
const query = z.object({
  'data.id': z
    .string()
    .regex(/^[\w-]{1,64}$/)
    .optional(),
  type: z.string().max(40).optional(),
  topic: z.string().max(40).optional(),
});
// Shape only (the content is not used): an object of bounded size, checked by the pipeline.
const body = z.record(z.string(), z.unknown()).optional();

const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Não autorizado.');

export const POST = route<'public', typeof body, typeof query>(
  {
    methods: ['POST'],
    access: 'public',
    csrf: 'none',
    rateLimit: RL.webhook,
    rateLimitFailOpen: true,
    body,
    query,
  },
  async ({ req, query: q, requestId }) => {
    const env = getEnv();
    const topic = q.type ?? q.topic ?? '';
    const dataId = q['data.id'] ?? null;
    const xRequestId = req.headers.get('x-request-id');
    if (!env.MP_WEBHOOK_SECRET) {
      logger.error({ requestId }, 'webhook received but MP_WEBHOOK_SECRET is not set');
      throw unauthorized();
    }
    if (!xRequestId || !/^[\w-]{8,64}$/.test(xRequestId)) throw unauthorized();
    const secrets = [env.MP_WEBHOOK_SECRET, env.MP_WEBHOOK_SECRET_PREVIOUS].filter(
      (s): s is string => !!s,
    );
    const signature = req.headers.get('x-signature');
    const verdict = verifyNotification({ dataId, requestId: xRequestId, signature, secrets });
    if (verdict !== 'ok') {
      logger.warn({ requestId, verdict, topic: topic.slice(0, 20) }, 'security: webhook rejected');
      throw unauthorized();
    }

    if (topic !== 'order' || !dataId) {
      logger.info({ requestId, topic: topic.slice(0, 20) }, 'webhook ignored (topic)');
      return { ok: true, outcome: 'IGNORED' };
    }

    // Replay guard in front of the unique WebhookEvent.requestId.
    const fresh = await redis()
      .set(`mpwh:${xRequestId}`, '1', 'EX', 86_400, 'NX')
      .catch(() => 'OK');
    if (fresh !== 'OK') return { ok: true, outcome: 'DUPLICATE' };
    try {
      await db().webhookEvent.create({
        data: {
          provider: 'MERCADO_PAGO',
          requestId: xRequestId,
          topic,
          resourceId: dataId,
          signatureTs: new Date(tsMillis(parseSignature(signature)!.ts)),
        },
      });
    } catch (err) {
      if (pgErrorCode(err) === PG.uniqueViolation) return { ok: true, outcome: 'DUPLICATE' };
      throw err;
    }
    await enqueue.paymentSync(dataId, 'webhook', xRequestId);
    return { ok: true, outcome: 'RECEIVED' };
  },
);
