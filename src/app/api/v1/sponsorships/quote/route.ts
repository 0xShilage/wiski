import { quoteInput } from '@/server/checkout/input';
import { quoteMovie } from '@/server/checkout/orders';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/sponsorships/quote — live price breakdown for a movie (03 §5.3). Side-effect free;
 * the moderator/VIP perk applies only to the signed-in session (read from the DB, never the body).
 */
export const POST = route(
  { methods: ['POST'], access: 'public', rateLimit: RL.quote, body: quoteInput },
  async ({ user, ipKey, body }) => {
    const q = await quoteMovie(user, ipKey === 'unknown' ? null : ipKey, body);
    return {
      breakdown: q.breakdown.lines,
      totalCents: q.breakdown.totalCents,
      available: q.available,
    };
  },
);
