import { getPublicCampaign } from '@/server/catalog/read';
import { Problems } from '@/server/http/problem';
import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { channel } from '@/server/realtime/publish';
import { sseResponse } from '@/server/realtime/sse';

/** GET /api/v1/campaigns/[id]/events — public SSE `progress` events (bar moves as Pix are paid). */
export const GET = route<'public', undefined, undefined, { id: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.events },
  async ({ req, ipKey, params }) => {
    const id = uuidParam(params.id);
    const c = await getPublicCampaign(id);
    if (!c) throw Problems.notFound();
    return sseResponse(req, {
      channel: channel.campaign(id),
      event: 'progress',
      ipKey,
      initial: {
        type: 'progress',
        goalCents: c.goalCents,
        raisedCents: c.raisedCents,
        remainingCents: c.remainingCents,
        supporterCount: c.supporterCount,
        state: c.state,
        at: new Date().toISOString(),
      },
    });
  },
);
