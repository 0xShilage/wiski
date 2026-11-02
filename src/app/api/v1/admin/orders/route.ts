import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { ordersQuery } from '@/server/admin/input';
import { listOrders, orderCounts } from '@/server/checkout/admin';

/** GET /api/v1/admin/orders?status=&texts=1&code=&before= — orders (e-mails for the streamer only). */
export const GET = route<'moderator', undefined, typeof ordersQuery>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin, query: ordersQuery },
  async ({ query, user }) => ({
    ...(await listOrders(user.role, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.texts ? { pendingTexts: true } : {}),
      ...(query.code ? { code: query.code } : {}),
      ...(query.before ? { before: query.before } : {}),
    })),
    counts: await orderCounts(),
  }),
);
