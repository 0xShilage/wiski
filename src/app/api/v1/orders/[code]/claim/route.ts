import { claimOrder, codeParam } from '@/server/checkout/access';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/orders/[code]/claim — attach a guest order (in this browser's cookie) to my account. */
export const POST = route<'user', undefined, undefined, { code: string }>(
  { methods: ['POST'], access: 'user', rateLimit: RL.orderWrite },
  async ({ req, user, params, requestId }) =>
    claimOrder(codeParam(params.code), user, req, requestId),
);
