import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mfaVerifiedUntil, rememberDevice } from '@/server/auth/mfa';
import { enableTotp } from '@/server/auth/totp';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

const body = z.object({ code: z.string().regex(/^\s*\d{6}\s*$/) }).strict();

/**
 * POST /api/v1/me/totp/enable — `{code}` from the app → authenticator on, this session verified,
 * the 6 recovery codes (shown once).
 */
export const POST = route(
  {
    methods: ['POST'],
    access: 'moderator',
    mfa: false,
    stepUp: true,
    rateLimit: RL.totpVerify,
    body,
  },
  async ({ user, session, body, requestId }) => {
    const { recoveryCodes, mfaAt } = await enableTotp(user, session, body.code, { requestId });
    const res = NextResponse.json(
      { recoveryCodes, verifiedUntil: mfaVerifiedUntil(mfaAt).toISOString() },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    );
    rememberDevice(res, user, mfaAt);
    return res;
  },
);
