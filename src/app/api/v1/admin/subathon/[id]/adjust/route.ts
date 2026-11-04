import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { subathonAdjustInput } from '@/server/admin/input';
import { subathonAdminView } from '@/server/subathon/admin';
import { adjustTime } from '@/server/subathon/timer';

/** POST /api/v1/admin/subathon/[id]/adjust — add or remove time by hand (idempotent per key). */
export const POST = route<'streamer', typeof subathonAdjustInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'streamer', rateLimit: RL.adminWrite, body: subathonAdjustInput },
  async ({ user, requestId, body, params }) => {
    await adjustTime({ actor: user, requestId }, uuidParam(params.id), body);
    return subathonAdminView();
  },
);
