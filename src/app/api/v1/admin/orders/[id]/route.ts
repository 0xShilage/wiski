import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { getOrder } from '@/server/checkout/admin';

/** GET /api/v1/admin/orders/[id] — one order. */
export const GET = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async ({ params, user }) => ({ order: await getOrder(user.role, uuidParam(params.id)) }),
);
