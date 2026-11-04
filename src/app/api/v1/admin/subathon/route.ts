import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { subathonCreateInput } from '@/server/admin/input';
import { subathonAdminView } from '@/server/subathon/admin';
import { createSubathon } from '@/server/subathon/timer';

/** GET /api/v1/admin/subathon — the open (or last) subathon, its latest entries, StreamElements status. */
export const GET = route<'streamer'>(
  { methods: ['GET'], access: 'streamer', rateLimit: RL.admin },
  async () => subathonAdminView(),
);

/** POST /api/v1/admin/subathon — a new subathon (starting time, R$ rule, rates, optional cap). */
export const POST = route<'streamer', typeof subathonCreateInput>(
  { methods: ['POST'], access: 'streamer', rateLimit: RL.adminWrite, body: subathonCreateInput },
  async ({ user, requestId, body }) => {
    await createSubathon({ actor: user, requestId }, body);
    return Response.json(await subathonAdminView(), { status: 201 });
  },
);
