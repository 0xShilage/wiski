import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { overlayStreamQuery } from '@/server/admin/input';
import { overlayAccess } from '@/server/overlay/keys';
import { overlayChannel, snapshot } from '@/server/overlay/state';
import { acquireStreamSlot, sseResponse } from '@/server/realtime/events';

/** GET /api/v1/overlay/stream?widget= — SSE for one widget (overlay cookie; sanitised payloads). */
export const GET = route<'public', undefined, typeof overlayStreamQuery>(
  { methods: ['GET'], access: 'public', rateLimit: RL.overlayStream, query: overlayStreamQuery },
  async ({ req, query, ipKey }) => {
    const access = await overlayAccess(req, query.widget);
    if (!access) throw Problems.unauthenticated();
    const release = await acquireStreamSlot(`overlay:${ipKey}`, 8);
    if (!release) throw Problems.rateLimited(30);
    const initial = (await snapshot(query.widget)) ?? { type: 'ready' };
    return sseResponse(req, overlayChannel(query.widget), initial, release);
  },
);
