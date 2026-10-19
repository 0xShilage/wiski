import { db } from '@/server/db';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { orderIdsFromCookie } from '@/server/orders/cookie';
import { OrderProblems } from '@/server/orders/problems';
import { publicCodeOk } from '@/server/orders/read';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/orders/[code]/claim — attach a guest order (held in the order cookie) to the
 * signed-in account ("Vincular à minha conta"). The purchase-time buyer key stays as it was.
 */
export const POST = route<'user', undefined, undefined, { code: string }>(
  { methods: ['POST'], access: 'user', rateLimit: RL.orderWrite },
  async ({ req, user, params }) => {
    if (!publicCodeOk(params.code)) throw Problems.notFound();
    const order = await db().order.findUnique({
      where: { publicCode: params.code },
      select: { id: true, userId: true },
    });
    if (!order || !orderIdsFromCookie(req).includes(order.id)) throw Problems.notFound();
    if (order.userId === user.id) return { claimed: true };
    if (order.userId) throw OrderProblems.alreadyClaimed();
    const res = await db().order.updateMany({
      where: { id: order.id, userId: null },
      data: { userId: user.id, claimedAt: new Date() },
    });
    if (res.count !== 1) throw OrderProblems.alreadyClaimed();
    await db().legalAcceptance.updateMany({
      where: { orderId: order.id, userId: null },
      data: { userId: user.id },
    });
    return { claimed: true };
  },
);
