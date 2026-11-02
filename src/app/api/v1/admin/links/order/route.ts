import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { linkOrderInput } from '@/server/admin/input';
import { reorderLinks } from '@/server/links/links';

/** PUT /api/v1/admin/links/order — the new order (every link id, once). */
export const PUT = route<'streamer', typeof linkOrderInput>(
  { methods: ['PUT'], access: 'streamer', rateLimit: RL.adminWrite, body: linkOrderInput },
  async ({ user, requestId, body }) => ({
    links: await reorderLinks({ actor: user, requestId }, body.ids),
  }),
);
