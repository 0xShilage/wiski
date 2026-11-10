import { sessionOrderInput } from '@/server/admin/input';
import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { reorderSession } from '@/server/live/schedule';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/admin/sessions/[id]/order — `{expectedVersion, entries: ["ORDER:<id>", …]}`:
 * "Reorganizar" (2026-11-09) puts the session's entries in this order.
 */
export const POST = route<'moderator', typeof sessionOrderInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: sessionOrderInput },
  async ({ body, user, requestId, params }) => ({
    session: await reorderSession(
      { actor: user, requestId },
      uuidParam(params.id),
      body.expectedVersion,
      body.entries,
    ),
  }),
);
