import { buyerFrom } from '@/server/checkout/http';
import { movieOrderInput } from '@/server/checkout/input';
import { createMovieOrder } from '@/server/checkout/orders';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/sponsorships — "Patrocine agora": reserve the movie and create its Pix (11 §2.1).
 * Guests welcome (contact e-mail); Turnstile; `Idempotency-Key` required. Returns the Pix and the
 * order-link token once, and puts the order in this browser's `__Host-wf_order` cookie.
 */
export const POST = route(
  {
    methods: ['POST'],
    access: 'public',
    rateLimit: RL.orderCreate,
    turnstile: 'sponsor',
    body: movieOrderInput,
  },
  async (ctx) => createMovieOrder(buyerFrom(ctx), ctx.body),
);
