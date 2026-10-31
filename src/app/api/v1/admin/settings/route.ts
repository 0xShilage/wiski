import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { settingsInput } from '@/server/admin/input';
import { getSettings, setOrdersOpen } from '@/server/admin/settings';

/** GET /api/v1/admin/settings — the streamer's switches. */
export const GET = route<'streamer'>(
  { methods: ['GET'], access: 'streamer', rateLimit: RL.admin },
  async () => ({ settings: await getSettings() }),
);

/** PUT /api/v1/admin/settings — `{ordersOpen}` (checkout on/off); Google step-up. */
export const PUT = route<'streamer', typeof settingsInput>(
  { methods: ['PUT'], access: 'streamer', stepUp: true, rateLimit: RL.adminWrite, body: settingsInput },
  async ({ user, requestId, body }) => ({
    settings: await setOrdersOpen({ actor: user, requestId }, body.ordersOpen),
  }),
);
