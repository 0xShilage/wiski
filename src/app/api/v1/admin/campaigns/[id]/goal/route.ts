import { lowerGoal } from '@/server/catalog/campaigns';
import { goalInput } from '@/server/catalog/input';
import { getAdmin } from '@/server/catalog/read';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/admin/campaigns/[id]/goal — lower the goal (never below raised + reserved). */
export const POST = route<'moderator', typeof goalInput, undefined, { id: string }>(
  {
    methods: ['POST'],
    access: 'moderator',
    stepUp: true,
    rateLimit: RL.adminWrite,
    body: goalInput,
  },
  async ({ user, requestId, params, body }) => {
    const id = uuidParam(params.id);
    await lowerGoal({ actor: user, requestId }, id, body.goalCents);
    return { item: await getAdmin(id) };
  },
);
