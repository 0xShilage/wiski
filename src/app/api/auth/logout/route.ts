import { NextResponse } from 'next/server';
import { clearHostCookie, COOKIE } from '@/server/auth/cookies';
import { forgetDevice } from '@/server/auth/mfa';
import { revokeOwnSession } from '@/server/auth/session';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { isPrivileged } from '@/server/rbac';

/**
 * POST /api/auth/logout — revokes the current session (CSRF-protected mutation) and forgets this
 * browser's admin second factor, so the next person on a shared computer is asked again.
 */
export const POST = route(
  { methods: ['POST'], access: 'user', rateLimit: RL.account },
  async ({ user, session, audit }) => {
    await revokeOwnSession(user.id, session.id);
    if (isPrivileged(user.role)) {
      await audit({
        action: 'auth.logout',
        targetType: 'Session',
        targetId: session.id,
        metadata: { scope: 'current' },
      });
    }
    const res = NextResponse.json({ ok: true });
    clearHostCookie(res, COOKIE.session);
    forgetDevice(res);
    return res;
  },
);
