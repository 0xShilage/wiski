import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { overlayKeyInput } from '@/server/admin/input';
import { createOverlayKey, listOverlayKeys } from '@/server/overlay/keys';

/** GET /api/v1/admin/overlay-keys — OBS keys (never the key itself). */
export const GET = route<'streamer'>(
  { methods: ['GET'], access: 'streamer', rateLimit: RL.admin },
  async () => ({ keys: await listOverlayKeys() }),
);

/** POST /api/v1/admin/overlay-keys — new key; the raw key is in this answer only. */
export const POST = route<'streamer', typeof overlayKeyInput>(
  { methods: ['POST'], access: 'streamer', stepUp: true, rateLimit: RL.adminWrite, body: overlayKeyInput },
  async ({ user, requestId, body }) =>
    Response.json(await createOverlayKey({ actor: user, requestId }, body), { status: 201 }),
);
