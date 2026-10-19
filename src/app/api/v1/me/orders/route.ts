import { route } from '@/server/http/route';
import { listMyOrders } from '@/server/orders/read';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/me/orders — "Minhas compras": the signed-in user's sponsorships and contributions. */
export const GET = route(
  { methods: ['GET'], access: 'user', rateLimit: RL.account },
  async ({ user }) => ({
    orders: await listMyOrders(user.id),
  }),
);
