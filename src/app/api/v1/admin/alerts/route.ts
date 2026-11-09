import { route } from '@/server/http/route';
import { alertSettingsSchema, getAlertSettings, setAlertSettings } from '@/server/overlay/alerts';
import { RL } from '@/server/ratelimit/rules';

/**
 * GET / PUT /api/v1/admin/alerts — "Novo patrocínio" extras (2026-11-09): the voice on/off and
 * which voice, and the thank-you line in chat on/off. `voiceReady` / `chatReady` say whether the
 * server has the Google key / StreamElements JWT.
 */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => ({ alerts: await getAlertSettings() }),
);

export const PUT = route<'moderator', typeof alertSettingsSchema>(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: alertSettingsSchema },
  async ({ body, user, requestId }) => ({
    alerts: await setAlertSettings({ actor: user, requestId }, body),
  }),
);
