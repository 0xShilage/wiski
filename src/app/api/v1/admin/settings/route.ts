import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { settingsInput } from '@/server/admin/input';
import { getSettings, setOrdersOpen } from '@/server/admin/settings';

/** GET /api/v1/admin/settings — the streamer's switches. */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => ({ settings: await getSettings() }),
);

/** PUT /api/v1/admin/settings — `{ordersOpen}` (checkout on/off); Google step-up. */
export const PUT = route<'moderator', typeof settingsInput>(
  {
    methods: ['PUT'],
    access: 'moderator',
    stepUp: true,
    rateLimit: RL.adminWrite,
    body: settingsInput,
  },
  async ({ user, requestId, body }) => ({
    settings: await setOrdersOpen({ actor: user, requestId }, body.ordersOpen),
  }),
);
