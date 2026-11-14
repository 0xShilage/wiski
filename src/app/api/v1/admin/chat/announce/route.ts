import { announceInput, setAnnounceSettings } from '@/server/chat/announce';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * PUT /api/v1/admin/chat/announce — Chat da live › Anúncios automáticos (2026-11-13): switch each
 * announcement on or off and set its text.
 */
export const PUT = route<'moderator', typeof announceInput>(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: announceInput },
  async ({ user, requestId, body }) => ({
    announce: await setAnnounceSettings({ actor: user, requestId }, body),
  }),
);
