import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { subathonActionInput } from '@/server/admin/input';
import { subathonAdminView } from '@/server/subathon/admin';
import { changeStatus } from '@/server/subathon/timer';

/** POST /api/v1/admin/subathon/[id]/action — start, pause, resume or end the timer. */
export const POST = route<'moderator', typeof subathonActionInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: subathonActionInput },
  async ({ user, requestId, body, params }) => {
    await changeStatus(
      { actor: user, requestId },
      uuidParam(params.id),
      body.action,
      body.expectedVersion,
    );
    return subathonAdminView();
  },
);
