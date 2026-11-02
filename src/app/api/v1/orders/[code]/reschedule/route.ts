import { codeParam } from '@/server/checkout/access';
import { db } from '@/server/db';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { rescheduleInput } from '@/server/admin/input';
import { rescheduleOptions, rescheduleOwn } from '@/server/live/schedule';

async function own(code: string, userId: string) {
  const o = await db().order.findUnique({
    where: { publicCode: code },
    select: {
      id: true,
      userId: true,
      kind: true,
      status: true,
      runtimeMinutes: true,
      sessionId: true,
      rescheduleCount: true,
    },
  });
  if (!o || o.userId !== userId || o.kind !== 'MOVIE') throw Problems.notFound();
  return o;
}

/** GET /api/v1/orders/[code]/reschedule — sessions the owner may move their movie to (04 §7). */
export const GET = route<'user', undefined, undefined, { code: string }>(
  { methods: ['GET'], access: 'user', rateLimit: RL.orderRead },
  async ({ params, user }) => {
    const o = await own(codeParam(params.code), user.id);
    return {
      status: o.status,
      left: Math.max(0, 2 - (o.rescheduleCount ?? 0)),
      sessions:
        o.status === 'SCHEDULED' ? await rescheduleOptions(o.runtimeMinutes ?? 0, o.sessionId) : [],
    };
  },
);

/** POST /api/v1/orders/[code]/reschedule — `{sessionId}`; up to 24 h before, max 2 times. */
export const POST = route<'user', typeof rescheduleInput, undefined, { code: string }>(
  { methods: ['POST'], access: 'user', rateLimit: RL.orderWrite, body: rescheduleInput },
  async ({ params, user, body, requestId }) => {
    const o = await own(codeParam(params.code), user.id);
    await rescheduleOwn(user, o.id, body.sessionId, requestId);
    return { ok: true };
  },
);
