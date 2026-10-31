import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { versionInput } from '@/server/admin/input';
import { cancelSession } from '@/server/live/schedule';

/** POST /api/v1/admin/sessions/[id]/cancel — PLANNED → CANCELLED (streamer); everything on it goes back to the queue. */
export const POST = route<'streamer', typeof versionInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'streamer', rateLimit: RL.adminWrite, body: versionInput },
  async ({ body, user, requestId, params }) => ({
    session: await cancelSession({ actor: user, requestId }, uuidParam(params.id), body.expectedVersion),
  }),
);
