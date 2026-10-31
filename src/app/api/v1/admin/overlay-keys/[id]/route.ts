import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { revokeOverlayKey } from '@/server/overlay/keys';

/** DELETE /api/v1/admin/overlay-keys/[id] — revoke (open overlays stop at their next reconnect). */
export const DELETE = route<'streamer', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'streamer', stepUp: true, rateLimit: RL.adminWrite },
  async ({ user, requestId, params }) => {
    await revokeOverlayKey({ actor: user, requestId }, uuidParam(params.id));
    return new Response(null, { status: 204 });
  },
);
