import { NextResponse } from 'next/server';
import { clearHostCookie, COOKIE } from '@/server/auth/cookies';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { eraseInput } from '@/server/admin/input';
import { eraseMyAccount } from '@/server/users/lgpd';

/**
 * POST /api/v1/me/erase — `{confirmUsername}`; needs a Google login in the last 10 minutes.
 * Reviews, likes, reports and passkeys go; the account is anonymised; every session ends.
 */
export const POST = route<'user', typeof eraseInput>(
  { methods: ['POST'], access: 'user', stepUp: true, rateLimit: RL.accountErase, body: eraseInput },
  async ({ user, requestId, body }) => {
    await eraseMyAccount(user, body.confirmUsername, requestId);
    const res = NextResponse.json({ erased: true });
    clearHostCookie(res, COOKIE.session);
    return res;
  },
);
