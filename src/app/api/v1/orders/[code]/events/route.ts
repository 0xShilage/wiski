import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { orderIdsFromCookie } from '@/server/orders/cookie';
import { canAccessOrder, findOrderByCode, publicCodeOk } from '@/server/orders/read';
import { RL } from '@/server/ratelimit/rules';
import { channel } from '@/server/realtime/publish';
import { sseResponse } from '@/server/realtime/sse';

/** GET /api/v1/orders/[code]/events — SSE `status` events for the order page (owner / cookie). */
export const GET = route<'public', undefined, undefined, { code: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.events },
  async ({ req, user, ipKey, params }) => {
    if (!publicCodeOk(params.code)) throw Problems.notFound();
    const order = await findOrderByCode(params.code);
    if (!order || !canAccessOrder(order, { user, cookieIds: orderIdsFromCookie(req) })) {
      throw Problems.notFound();
    }
    return sseResponse(req, {
      channel: channel.order(order.id),
      event: 'status',
      ipKey,
      initial: {
        type: 'status',
        code: order.publicCode,
        status: order.status,
        paymentStatus: order.payment?.status ?? 'PENDING',
        at: new Date().toISOString(),
      },
    });
  },
);
