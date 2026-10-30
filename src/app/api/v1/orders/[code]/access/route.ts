import { codeParam, exchangeToken } from '@/server/checkout/access';
import { accessInput } from '@/server/checkout/input';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/orders/[code]/access — `{token}` from the order link's URL fragment → the order is
 * added to this browser's sealed `__Host-wf_order` cookie. Constant-time check; tight rate limit;
 * failures are security events (05 §5).
 */
export const POST = route<'public', typeof accessInput, undefined, { code: string }>(
  { methods: ['POST'], access: 'public', rateLimit: RL.orderAccess, body: accessInput },
  async ({ req, params, body, ipKey }) =>
    exchangeToken(codeParam(params.code), body.token, req, ipKey),
);
