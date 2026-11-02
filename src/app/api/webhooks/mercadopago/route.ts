import { uniqueViolation } from '@/server/checkout/orders';
import { db } from '@/server/db';
import { getEnv } from '@/server/env';
import { HttpError } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { logger } from '@/server/log';
import { verifyMpSignature } from '@/server/payments/mercadopago/signature';
import { wakeWorker } from '@/server/payments/wake';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/webhooks/mercadopago?data.id=…&type=payment — normative spec: 05 §6.
 * Verify (HMAC over the query-string id, x-request-id and ts; constant time; current + previous
 * secret; ±10 min) → store a WebhookEvent (unique x-request-id = replay guard) → wake the worker
 * → 200, fast. The body is never parsed or trusted: the worker re-fetches the payment from MP.
 */
const ok = (status: string) => Response.json({ status });

export const POST = route(
  {
    methods: ['POST'],
    access: 'public',
    csrf: 'none',
    ignoreBody: true,
    rateLimit: RL.webhook,
    rateLimitFailOpen: true,
  },
  async ({ req, ipKey }) => {
    const env = getEnv();
    const q = req.nextUrl.searchParams;
    const dataId = q.get('data.id');
    const type = q.get('type');
    const requestId = req.headers.get('x-request-id');
    const secrets = [env.MP_WEBHOOK_SECRET, env.MP_WEBHOOK_SECRET_PREVIOUS].filter(
      (s): s is string => Boolean(s),
    );
    const sig = verifyMpSignature({
      xSignature: req.headers.get('x-signature'),
      xRequestId: requestId,
      dataId,
      secrets,
      now: Date.now(),
    });
    if (!sig.ok || !requestId || requestId.length > 128) {
      logger.warn(
        { security: 'webhook-signature', reason: sig.ok ? 'request-id' : sig.reason, ipKey },
        'mercadopago webhook rejected',
      );
      throw new HttpError(401, 'BAD_SIGNATURE', 'Assinatura inválida.');
    }
    if (type !== 'payment') return ok('IGNORED');
    if (!dataId || !/^\d{1,20}$/.test(dataId)) return ok('IGNORED');
    try {
      await db().webhookEvent.create({
        data: {
          provider: 'MERCADO_PAGO',
          requestId,
          topic: type,
          resourceId: dataId,
          signatureTs: sig.ts,
        },
      });
    } catch (err) {
      if (uniqueViolation(err)) return ok('DUPLICATE'); // replay or MP retry: stop retrying
      throw err;
    }
    await wakeWorker();
    return ok('RECEIVED');
  },
);
