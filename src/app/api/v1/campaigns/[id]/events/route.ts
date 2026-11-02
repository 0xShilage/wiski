import { getPublicCampaign } from '@/server/catalog/read';
import { Problems } from '@/server/http/problem';
import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { acquireStreamSlot, channel, sseResponse } from '@/server/realtime/events';

/** GET /api/v1/campaigns/[id]/events — SSE campaign progress (11 §8); ≤ 5 streams per IP. */
export const GET = route<'public', undefined, undefined, { id: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.events },
  async ({ req, params, ipKey }) => {
    const c = await getPublicCampaign(uuidParam(params.id));
    if (!c) throw Problems.notFound();
    const release = await acquireStreamSlot(`ip:${ipKey}`, 5);
    if (!release) throw Problems.rateLimited(30);
    return sseResponse(
      req,
      channel.campaign(c.id),
      {
        type: 'progress',
        raisedCents: c.raisedCents,
        remainingCents: c.remainingCents,
        supporterCount: c.supporterCount,
        state: c.state,
        at: new Date().toISOString(),
      },
      release,
    );
  },
);
