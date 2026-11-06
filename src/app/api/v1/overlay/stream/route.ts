import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { overlayStreamQuery } from '@/server/admin/input';
import { overlayAccess } from '@/server/overlay/keys';
import { missedAlerts } from '@/server/overlay/publish';
import { pendingShow } from '@/server/overlay/show';
import { overlayChannel, snapshot } from '@/server/overlay/state';
import { acquireStreamSlot, sseResponse } from '@/server/realtime/events';

/**
 * Streams one OBS can hold at once. Every browser source is a stream and an OBS with several
 * scenes easily has 10–20 of them (2026-11-05; it was 8, which refused some sources at random).
 * Only holders of a valid overlay key get this far.
 */
const OVERLAY_STREAMS_PER_IP = 40;

/**
 * GET /api/v1/overlay/stream?widget=&since= — SSE for one widget (overlay cookie; sanitised
 * payloads). `since`: "Novo patrocínio" alerts the overlay missed while reconnecting.
 */
export const GET = route<'public', undefined, typeof overlayStreamQuery>(
  { methods: ['GET'], access: 'public', rateLimit: RL.overlayStream, query: overlayStreamQuery },
  async ({ req, query, ipKey }) => {
    const access = await overlayAccess(req, query.widget);
    if (!access) throw Problems.unauthenticated();
    const slot = await acquireStreamSlot(`overlay:${ipKey}`, OVERLAY_STREAMS_PER_IP);
    if (!slot) throw Problems.rateLimited(30);
    const initial = (await snapshot(query.widget)) ?? { type: 'ready' };
    const w = query.widget;
    // missed alerts; or, for a pop-in widget shown by a chat command, the time it has left
    const replay =
      w === 'patrocinio'
        ? await missedAlerts(query.since)
        : w === 'agora' || w === 'fila'
          ? await pendingShow(w)
          : [];
    return sseResponse(req, overlayChannel(query.widget), initial, { slot, replay });
  },
);
