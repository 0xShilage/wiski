import { idempotencyKey } from '@/server/checkout/http';
import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { refundInput } from '@/server/admin/input';
import { requestRefund } from '@/server/payments/refunds';

/**
 * POST /api/v1/admin/orders/[id]/refund — streamer exception tool (04 §8): duplicate payment,
 * processing error or legal requirement. Passkey + Google step-up + `Idempotency-Key`.
 */
export const POST = route<'streamer', typeof refundInput, undefined, { id: string }>(
  {
    methods: ['POST'],
    access: 'streamer',
    stepUp: true,
    rateLimit: RL.adminWrite,
    body: refundInput,
  },
  async ({ req, params, user, requestId, body }) =>
    requestRefund({ actor: user, requestId }, uuidParam(params.id), body, idempotencyKey(req)),
);
