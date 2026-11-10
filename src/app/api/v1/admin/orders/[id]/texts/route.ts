import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { textsInput } from '@/server/admin/input';
import { reviewTexts } from '@/server/checkout/admin';

/**
 * POST /api/v1/admin/orders/[id]/texts — approve/reject the sponsor message and guest name (Q10,
 * Q16); 2026-11-09: `wall: false` takes the order off the supporters wall.
 */
export const POST = route<'moderator', typeof textsInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: textsInput },
  async ({ params, user, requestId, body }) => ({
    order: await reviewTexts({ actor: user, requestId }, uuidParam(params.id), {
      expectedVersion: body.expectedVersion,
      ...(body.message ? { message: body.message } : {}),
      ...(body.displayName ? { displayName: body.displayName } : {}),
      ...(body.wall === false ? { wall: false as const } : {}),
    }),
  }),
);
