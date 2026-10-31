import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { roleInput } from '@/server/admin/input';
import { setRole } from '@/server/users/admin';

/** POST /api/v1/admin/users/[id]/role — streamer: USER ↔ MODERATOR (ends the person's sessions). */
export const POST = route<'streamer', typeof roleInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'streamer', stepUp: true, rateLimit: RL.adminWrite, body: roleInput },
  async ({ params, user, requestId, body }) => ({
    user: await setRole({ actor: user, requestId }, uuidParam(params.id), body.role),
  }),
);
