import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { goalCreateInput } from '@/server/admin/input';
import { createGoal, listGoals } from '@/server/goals/goals';

/** GET /api/v1/admin/goals — goals with live progress. */
export const GET = route<'streamer'>(
  { methods: ['GET'], access: 'streamer', rateLimit: RL.admin },
  async () => ({ goals: await listGoals() }),
);

/** POST /api/v1/admin/goals — a new goal (count, revenue shown as % only, minutes watched). */
export const POST = route<'streamer', typeof goalCreateInput>(
  { methods: ['POST'], access: 'streamer', rateLimit: RL.adminWrite, body: goalCreateInput },
  async ({ user, requestId, body }) =>
    Response.json({ goal: await createGoal({ actor: user, requestId }, body) }, { status: 201 }),
);
