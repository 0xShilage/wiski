import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { deleteDayOff } from '@/server/live/daysoff';

/** DELETE /api/v1/admin/days-off/[id] — the live is back on those days. */
export const DELETE = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId, params }) => {
    await deleteDayOff({ actor: user, requestId }, uuidParam(params.id));
    return new Response(null, { status: 204 });
  },
);
