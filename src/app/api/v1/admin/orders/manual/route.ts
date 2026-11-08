import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { manualPaymentInput } from '@/server/admin/input';
import { manualCandidates, registerManualPayment } from '@/server/checkout/admin';

/** GET /api/v1/admin/orders/manual — streamer: the titles that can be registered as paid ("Já pago"). */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => ({ candidates: await manualCandidates() }),
);

/** POST /api/v1/admin/orders/manual — streamer: register a payment received outside the site. */
export const POST = route<'moderator', typeof manualPaymentInput>(
  {
    methods: ['POST'],
    access: 'moderator',
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
