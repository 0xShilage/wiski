import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { versionInput } from '@/server/admin/input';
import { endSession } from '@/server/live/schedule';

/** POST /api/v1/admin/sessions/[id]/end — LIVE → DONE; what was not watched goes back to the queue. */
export const POST = route<'moderator', typeof versionInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: versionInput },
  async ({ body, user, requestId, params }) => ({
    session: await endSession({ actor: user, requestId }, uuidParam(params.id), body.expectedVersion),
  }),
);
