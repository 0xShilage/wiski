import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { versionInput } from '@/server/admin/input';
import { acceptOrder } from '@/server/checkout/admin';

/** POST /api/v1/admin/orders/[id]/accept — streamer: a NEEDS_ATTENTION order with an approved Pix becomes a sale. */
export const POST = route<'streamer', typeof versionInput, undefined, { id: string }>(
  {
    methods: ['POST'],
    access: 'streamer',
    stepUp: true,
    rateLimit: RL.adminWrite,
    body: versionInput,
  },
  async ({ params, user, requestId, body }) => ({
    order: await acceptOrder(
      { actor: user, requestId },
      uuidParam(params.id),
      body.expectedVersion,
    ),
  }),
);
