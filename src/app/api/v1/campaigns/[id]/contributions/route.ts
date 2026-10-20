import { NextResponse } from 'next/server';
import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { checkoutContribution } from '@/server/orders/checkout';
import { addOrderToCookie } from '@/server/orders/cookie';
import { contributionInput, idempotencyKeyFrom, requestHash } from '@/server/orders/input';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/campaigns/[id]/contributions — contribute to a series/franchise campaign (11 §2.2):
 * any whole-real amount ≥ R$ 5, capped at what's left; reserved while the Pix is pending.
 */
export const POST = route<'public', typeof contributionInput, undefined, { id: string }>(
  {
    methods: ['POST'],
    access: 'public',
    rateLimit: RL.checkout,
    turnstile: 'checkout',
    body: contributionInput,
  },
  async ({ req, user, ipKey, requestId, body, params }) => {
    const campaignId = uuidParam(params.id);
    const key = idempotencyKeyFrom(req.headers);
    const result = await checkoutContribution(
      { user, ipKey, requestId },
      campaignId,
      body,
      key,
      requestHash({ campaignId, ...body }),
    );
    const res = NextResponse.json(result, { status: 201 });
    addOrderToCookie(res, req, result.order.id);
    return res;
  },
);
