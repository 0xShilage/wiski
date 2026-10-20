import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { orderIdsFromCookie } from '@/server/orders/cookie';
import { buyerView, canAccessOrder, findOrderByCode, publicCodeOk } from '@/server/orders/read';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/orders/[code] — status, breakdown and (while payable) the Pix. Owner / cookie / staff. */
export const GET = route<'public', undefined, undefined, { code: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.orderRead },
  async ({ req, user, params }) => {
    if (!publicCodeOk(params.code)) throw Problems.notFound();
    const order = await findOrderByCode(params.code);
    if (!order || !canAccessOrder(order, { user, cookieIds: orderIdsFromCookie(req) })) {
      throw Problems.notFound();
    }
    return { order: await buyerView(order, { withPix: true }) };
  },
);
