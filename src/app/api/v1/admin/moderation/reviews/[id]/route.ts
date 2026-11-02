import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { moderationInput } from '@/server/reviews/input';
import { moderate } from '@/server/reviews/moderation';

/**
 * POST /api/v1/admin/moderation/reviews/[id] — `{action: HIDE|RESTORE|DISMISS|REMOVE,
 * expectedStatus}`. MODERATOR+ with a passkey; REMOVE is STREAMER-only. Audited.
 */
export const POST = route<'moderator', typeof moderationInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: moderationInput },
  async ({ params, body, user, audit }) =>
    moderate(user, uuidParam(params.id), body.action, body.expectedStatus, audit),
);
