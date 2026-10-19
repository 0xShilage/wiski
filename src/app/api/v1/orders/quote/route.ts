import { route } from '@/server/http/route';
import { quoteMovie } from '@/server/orders/checkout';
import { quoteInput } from '@/server/orders/input';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/orders/quote — live price breakdown for a movie sponsorship (04 §4). Side-effect
 * free; the moderator/VIP perk applies only when signed in (read from the database).
 */
export const POST = route(
  { methods: ['POST'], access: 'public', rateLimit: RL.quote, body: quoteInput },
  async ({ user, ipKey, requestId, body }) => quoteMovie({ user, ipKey, requestId }, body),
);
