import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clearHostCookie, COOKIE } from '@/server/auth/cookies';
import { revokeOwnSession } from '@/server/auth/session';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

const idSchema = z.uuid();

/** DELETE /api/v1/me/sessions/[id] — revoke one of MY sessions; anyone else's → 404. */
export const DELETE = route<'user', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'user', rateLimit: RL.account },
  async ({ user, session, params, audit }) => {
    const id = idSchema.safeParse(params.id);
    if (!id.success || !(await revokeOwnSession(user.id, id.data))) throw Problems.notFound();
    await audit({
      action: 'session.revoke',
      targetType: 'Session',
      targetId: id.data,
      metadata: { sessionId: id.data, scope: 'one' },
    });
    const res = NextResponse.json({ ok: true, current: id.data === session.id });
    if (id.data === session.id) clearHostCookie(res, COOKIE.session);
    return res;
  },
);
