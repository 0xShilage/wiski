import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { getSeasonSetting, seasonInput, setSeason } from '@/server/site/appearance';

/** GET / PUT /api/v1/admin/season — the seasonal theme (2026-11-10): `{theme, until}`. */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => ({ season: await getSeasonSetting() }),
);

export const PUT = route<'moderator', typeof seasonInput>(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: seasonInput },
  async ({ body, user, requestId }) => ({
    season: await setSeason({ actor: user, requestId }, body),
  }),
);
