import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { goalUpdateInput } from '@/server/admin/input';
import { deleteGoal, updateGoal } from '@/server/goals/goals';

/** PATCH /api/v1/admin/goals/[id] — edit a goal. */
export const PATCH = route<'moderator', typeof goalUpdateInput, undefined, { id: string }>(
  { methods: ['PATCH'], access: 'moderator', rateLimit: RL.adminWrite, body: goalUpdateInput },
  async ({ user, requestId, body, params }) => ({
    goal: await updateGoal({ actor: user, requestId }, uuidParam(params.id), body),
  }),
);

/** DELETE /api/v1/admin/goals/[id] — remove a goal. */
export const DELETE = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId, params }) => {
    await deleteGoal({ actor: user, requestId }, uuidParam(params.id));
    return new Response(null, { status: 204 });
  },
);
