import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { unsuspendUser } from '@/server/users/admin';

/** POST /api/v1/admin/users/[id]/unsuspend — lift a suspension (moderators: only ≤ 7-day ones). */
export const POST = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ params, user, requestId }) => ({
    user: await unsuspendUser({ actor: user, requestId }, uuidParam(params.id)),
  }),
);
