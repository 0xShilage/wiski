import { myOrders } from '@/server/checkout/access';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/me/orders — my sponsorships and contributions (newest 50). */
export const GET = route(
  { methods: ['GET'], access: 'user', rateLimit: RL.account },
  async ({ user }) => ({ orders: await myOrders(user) }),
);
