import { codeParam, loadVisibleOrder } from '@/server/checkout/access';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { acquireStreamSlot, channel, sseResponse } from '@/server/realtime/events';

/** GET /api/v1/orders/[code]/events — SSE status updates for the order page (03 §6). */
export const GET = route<'public', undefined, undefined, { code: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.events },
  async ({ req, user, params, ipKey }) => {
    const { order } = await loadVisibleOrder(codeParam(params.code), user, req);
    const release = await acquireStreamSlot(`ip:${ipKey}`, 5);
    if (!release) throw Problems.rateLimited(30);
    return sseResponse(
      req,
      channel.order(order.id),
      {
        type: 'status',
        code: order.publicCode,
        status: order.status,
        at: new Date().toISOString(),
      },
      release,
    );
  },
);
