import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { manualPaymentInput } from '@/server/admin/input';
import { manualCandidates, registerManualPayment } from '@/server/checkout/admin';

/** GET /api/v1/admin/orders/manual — streamer: the titles that can be registered as paid ("Já pago"). */
export const GET = route<'streamer'>(
  { methods: ['GET'], access: 'streamer', rateLimit: RL.admin },
  async () => ({ candidates: await manualCandidates() }),
);

/** POST /api/v1/admin/orders/manual — streamer: register a payment received outside the site. */
export const POST = route<'streamer', typeof manualPaymentInput>(
  {
    methods: ['POST'],
    access: 'streamer',
    stepUp: true,
    rateLimit: RL.adminWrite,
    body: manualPaymentInput,
  },
  async ({ user, requestId, body }) => ({
    order: await registerManualPayment(
      { actor: user, requestId },
      {
        itemId: body.itemId,
        amountCents: body.amountCents,
        sponsorName: body.sponsorName,
        message: body.message,
        idempotencyKey: body.idempotencyKey,
      },
    ),
  }),
);
