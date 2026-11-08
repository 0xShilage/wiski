import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { createCommandKey, revokeCommandKey } from '@/server/subathon/command';

/**
 * POST /api/v1/admin/subathon/command-key — a new key for the chat commands (replaces the old one;
 * shown once). DELETE — turn the chat commands off. Moderators and the streamer (second factor, as every admin
 * route).
 */
export const POST = route<'moderator'>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId }) => ({
    key: await createCommandKey({ actor: user, requestId }),
  }),
);

export const DELETE = route<'moderator'>(
  { methods: ['DELETE'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId }) => {
    await revokeCommandKey({ actor: user, requestId });
    return { ok: true };
  },
);
