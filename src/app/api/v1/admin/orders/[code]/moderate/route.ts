import { z } from 'zod';
import { route } from '@/server/http/route';
import { moderateOrderText } from '@/server/orders/admin';
import { RL } from '@/server/ratelimit/rules';

const body = z
  .object({
    field: z.enum(['displayName', 'message']),
    decision: z.enum(['APPROVED', 'REJECTED']),
  })
  .strict();

/** POST /api/v1/admin/orders/[code]/moderate — approve/reject the public name or message. */
export const POST = route<'moderator', typeof body, undefined, { code: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body },
  async ({ user, requestId, params, body }) => ({
    order: await moderateOrderText(
      { actor: user, requestId },
      params.code,
      body.field,
      body.decision,
    ),
  }),
);
