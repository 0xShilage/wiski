import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { orderIdsFromCookie } from '@/server/orders/cookie';
import { cancelByBuyer } from '@/server/orders/lifecycle';
import { buyerView, canAccessOrder, findOrderByCode, publicCodeOk } from '@/server/orders/read';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/orders/[code]/cancel — the buyer cancels an unpaid order (cancels the Pix first). */
export const POST = route<'public', undefined, undefined, { code: string }>(
  { methods: ['POST'], access: 'public', rateLimit: RL.orderWrite },
  async ({ req, user, params }) => {
    if (!publicCodeOk(params.code)) throw Problems.notFound();
    const order = await findOrderByCode(params.code);
    // Staff can read orders but only the buyer cancels from here.
    const owner =
      !!order && ((user && order.userId === user.id) || orderIdsFromCookie(req).includes(order.id));
    if (!order || !owner || !canAccessOrder(order, { user, cookieIds: orderIdsFromCookie(req) })) {
      throw Problems.notFound();
    }
    await cancelByBuyer(order.id);
    const fresh = await findOrderByCode(params.code);
    return { order: await buyerView(fresh!, { withPix: false }) };
  },
);
