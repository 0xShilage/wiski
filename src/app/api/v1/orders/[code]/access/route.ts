import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { addOrderToCookie } from '@/server/orders/cookie';
import { accessInput } from '@/server/orders/input';
import { publicCodeOk } from '@/server/orders/read';
import { RL } from '@/server/ratelimit/rules';
import { safeEqual, sha256 } from '@/server/security/crypto';

/**
 * POST /api/v1/orders/[code]/access — exchange the order-link token (`#t=…`, never sent to the
 * server by the browser on navigation) for the `__Host-wf_order` cookie. Constant-time compare;
 * a wrong token or code is the same 404.
 */
export const POST = route<'public', typeof accessInput, undefined, { code: string }>(
  { methods: ['POST'], access: 'public', rateLimit: RL.orderAccess, body: accessInput },
  async ({ req, params, body }) => {
    if (!publicCodeOk(params.code)) throw Problems.notFound();
    const order = await db().order.findUnique({
      where: { publicCode: params.code },
      select: { id: true, accessTokenHash: true },
    });
    const ok = !!order && safeEqual(sha256(body.token), order.accessTokenHash);
    if (!order || !ok) throw Problems.notFound();
    const res = NextResponse.json({ ok: true });
    addOrderToCookie(res, req, order.id);
    return res;
  },
);
