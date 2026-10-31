import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { statInput } from '@/server/admin/input';
import { listStats, setStat } from '@/server/mediakit/stats';

/** GET /api/v1/admin/stats — media kit numbers. */
export const GET = route<'streamer'>(
  { methods: ['GET'], access: 'streamer', rateLimit: RL.admin },
  async () => ({ stats: await listStats() }),
);

/** PUT /api/v1/admin/stats — `{platform, metric, value}`; value null clears the manual number. */
export const PUT = route<'streamer', typeof statInput>(
  { methods: ['PUT'], access: 'streamer', rateLimit: RL.adminWrite, body: statInput },
  async ({ user, requestId, body }) => {
    await setStat({ actor: user, requestId }, body.platform, body.metric, body.value);
    return { stats: await listStats() };
  },
);
