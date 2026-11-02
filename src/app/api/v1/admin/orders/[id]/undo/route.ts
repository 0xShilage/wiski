import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { versionInput } from '@/server/admin/input';
import { undoManualPayment } from '@/server/checkout/admin';

/** POST /api/v1/admin/orders/[id]/undo — streamer: cancel a "Já pago" registered by mistake. */
export const POST = route<'streamer', typeof versionInput, undefined, { id: string }>(
  {
    methods: ['POST'],
    access: 'streamer',
    stepUp: true,
    rateLimit: RL.adminWrite,
    body: versionInput,
  },
  async ({ params, user, requestId, body }) => ({
    order: await undoManualPayment(
      { actor: user, requestId },
      uuidParam(params.id),
      body.expectedVersion,
    ),
  }),
);
