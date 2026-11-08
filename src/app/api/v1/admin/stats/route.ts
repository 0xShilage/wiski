import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { statInput } from '@/server/admin/input';
import { listStats, setStat } from '@/server/mediakit/stats';

/** GET /api/v1/admin/stats — media kit numbers. */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => ({ stats: await listStats() }),
);

/** PUT /api/v1/admin/stats — `{platform, metric, value}`; value null clears the manual number. */
export const PUT = route<'moderator', typeof statInput>(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: statInput },
  async ({ user, requestId, body }) => {
    await setStat({ actor: user, requestId }, body.platform, body.metric, body.value);
    return { stats: await listStats() };
  },
);
