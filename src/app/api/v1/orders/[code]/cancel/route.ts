import { cancelOrder, codeParam } from '@/server/checkout/access';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/orders/[code]/cancel — cancel an unpaid order (owner, or the order cookie with its
 * cookie-bound CSRF token). Releases the movie / campaign amount right away.
 */
export const POST = route<'public', undefined, undefined, { code: string }>(
  { methods: ['POST'], access: 'public', rateLimit: RL.orderWrite },
  async ({ req, user, params, requestId }) =>
    cancelOrder(codeParam(params.code), user, req, requestId),
);
