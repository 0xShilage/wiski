import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { clearOrderLimits } from '@/server/ratelimit/reset';

/**
 * POST /api/v1/admin/users/[id]/unthrottle — streamer: clear the checkout counters of one account
 * (hourly caps and the coupon cool-down) so a locked-out viewer can order again. It relaxes an
 * anti-abuse control for the account's own buckets and its recent IP buckets, so: streamer only,
 * audited, and rate-limited itself. Nothing is cancelled and no limit is changed.
 */
export const POST = route<'streamer', undefined, undefined, { id: string }>(
  { methods: ['POST'], access: 'streamer', rateLimit: RL.adminWrite },
  async ({ params, user, requestId }) => ({
    reset: await clearOrderLimits({ actor: user, requestId }, uuidParam(params.id)),
  }),
);
