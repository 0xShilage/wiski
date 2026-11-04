import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { subathonUpdateInput } from '@/server/admin/input';
import { subathonAdminView } from '@/server/subathon/admin';
import { updateSubathon } from '@/server/subathon/timer';

/** PATCH /api/v1/admin/subathon/[id] — title, R$ rule, cap and rates (apply to what comes next). */
export const PATCH = route<'streamer', typeof subathonUpdateInput, undefined, { id: string }>(
  { methods: ['PATCH'], access: 'streamer', rateLimit: RL.adminWrite, body: subathonUpdateInput },
  async ({ user, requestId, body, params }) => {
    await updateSubathon({ actor: user, requestId }, uuidParam(params.id), body);
    return subathonAdminView();
  },
);
