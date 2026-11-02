import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { overlaySessionInput } from '@/server/admin/input';
import { exchangeOverlayKey, overlayCookieOf } from '@/server/overlay/keys';

/** POST /api/v1/overlay/session — overlay key (from the URL fragment) → `__Host-wf_overlay`. */
export const POST = route<'public', typeof overlaySessionInput>(
  { methods: ['POST'], access: 'public', rateLimit: RL.overlaySession, body: overlaySessionInput },
  async ({ req, body }) => exchangeOverlayKey(body.key, overlayCookieOf(req)),
);
