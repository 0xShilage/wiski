import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { versionInput } from '@/server/admin/input';
import { startSession } from '@/server/live/schedule';

/** POST /api/v1/admin/sessions/[id]/start — PLANNED → LIVE (one live session at a time). */
export const POST = route<'moderator', typeof versionInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: versionInput },
  async ({ body, user, requestId, params }) => ({
    session: await startSession(
      { actor: user, requestId },
      uuidParam(params.id),
      body.expectedVersion,
    ),
  }),
);
