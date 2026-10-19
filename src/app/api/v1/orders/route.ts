import { NextResponse } from 'next/server';
import { route } from '@/server/http/route';
import { checkoutMovie } from '@/server/orders/checkout';
import { addOrderToCookie } from '@/server/orders/cookie';
import { idempotencyKeyFrom, movieCheckoutInput, requestHash } from '@/server/orders/input';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/orders — sponsor a movie (guest or signed in): reserves the movie, creates the Pix.
 * Turnstile + Idempotency-Key + 1 pending order per buyer / 2 per IP. Returns the Pix and the
 * order-link token ONCE, and sets the sealed `__Host-wf_order` cookie.
 */
export const POST = route(
  {
    methods: ['POST'],
    access: 'public',
    rateLimit: RL.checkout,
    turnstile: 'checkout',
    body: movieCheckoutInput,
  },
  async ({ req, user, ipKey, requestId, body }) => {
    const key = idempotencyKeyFrom(req.headers);
    const result = await checkoutMovie({ user, ipKey, requestId }, body, key, requestHash(body));
    const res = NextResponse.json(result, { status: 201 });
    addOrderToCookie(res, req, result.order.id);
    return res;
  },
);
