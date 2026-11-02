import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { sessionCreateInput } from '@/server/admin/input';
import { createSession } from '@/server/live/schedule';

/** POST /api/v1/admin/sessions — plan a live session (start time, capacity in minutes, public note). */
export const POST = route<'moderator', typeof sessionCreateInput>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: sessionCreateInput },
  async ({ body, user, requestId }) => {
    const session = await createSession({ actor: user, requestId }, body);
    return Response.json({ session }, { status: 201 });
  },
);
