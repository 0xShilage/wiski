import { buyerFrom } from '@/server/checkout/http';
import { contributionInput } from '@/server/checkout/input';
import { createContribution } from '@/server/checkout/orders';
import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/campaigns/[id]/contributions — "Contribuir" with Pix (11 §2.2, §8). Any whole-real
 * amount ≥ R$ 5, never more than what's left; guests welcome; Turnstile; `Idempotency-Key`.
 */
export const POST = route<'public', typeof contributionInput, undefined, { id: string }>(
  {
    methods: ['POST'],
    access: 'public',
    rateLimit: RL.orderCreate,
    turnstile: 'contribute',
    body: contributionInput,
  },
  async (ctx) => createContribution(buyerFrom(ctx), uuidParam(ctx.params.id), ctx.body),
);
