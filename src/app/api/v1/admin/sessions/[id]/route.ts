import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { sessionUpdateInput } from '@/server/admin/input';
import { updateSession } from '@/server/live/schedule';

/** PATCH /api/v1/admin/sessions/[id] — time (planned only), capacity, note; `expectedVersion`. */
export const PATCH = route<'moderator', typeof sessionUpdateInput, undefined, { id: string }>(
  { methods: ['PATCH'], access: 'moderator', rateLimit: RL.adminWrite, body: sessionUpdateInput },
  async ({ body, user, requestId, params }) => ({
    session: await updateSession({ actor: user, requestId }, uuidParam(params.id), body),
  }),
);
