import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { dayOffInput } from '@/server/admin/input';
import { createDayOff } from '@/server/live/daysoff';

/** POST /api/v1/admin/days-off — "Dias sem live": mark a day (or a stretch) without a live. */
export const POST = route<'moderator', typeof dayOffInput>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: dayOffInput },
  async ({ user, requestId, body }) =>
    Response.json(await createDayOff({ actor: user, requestId }, body), { status: 201 }),
);
