import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { chatPresetsInput, setChatPresets } from '@/server/chat/say';

/** PUT /api/v1/admin/chat/presets — Chat da live: replace the saved messages (at most 20). */
export const PUT = route<'moderator', typeof chatPresetsInput>(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: chatPresetsInput },
  async ({ user, requestId, body }) => ({
    presets: await setChatPresets({ actor: user, requestId }, body.presets),
  }),
);
