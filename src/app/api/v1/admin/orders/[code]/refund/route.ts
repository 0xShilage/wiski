import { z } from 'zod';
import { route } from '@/server/http/route';
import { requestRefund } from '@/server/orders/admin';
import { idempotencyKeyFrom } from '@/server/orders/input';
import { RL } from '@/server/ratelimit/rules';

const body = z
  .object({ reason: z.enum(['DUPLICATE_PAYMENT', 'PROCESSING_ERROR', 'LEGAL_REQUIREMENT']) })
  .strict();

/**
 * POST /api/v1/admin/orders/[code]/refund — the exception refund (04 §8): total, through Mercado
 * Pago. STREAMER + Google step-up + passkey; `Idempotency-Key` required (a double-click refunds
 * once); audited.
 */
export const POST = route<'streamer', typeof body, undefined, { code: string }>(
  { methods: ['POST'], access: 'streamer', stepUp: true, rateLimit: RL.adminWrite, body },
  async ({ req, user, requestId, params, body }) => ({
    order: await requestRefund(
      { actor: user, requestId },
      params.code,
      body.reason,
      idempotencyKeyFrom(req.headers),
    ),
  }),
);
