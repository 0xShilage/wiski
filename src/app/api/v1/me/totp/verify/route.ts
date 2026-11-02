import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mfaVerifiedUntil, rememberDevice } from '@/server/auth/mfa';
import { verifyTotp } from '@/server/auth/totp';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

const body = z.union([
  z.object({ code: z.string().regex(/^\s*\d{6}\s*$/) }).strict(),
  z.object({ recoveryCode: z.string().min(10).max(16) }).strict(),
]);

/**
 * POST /api/v1/me/totp/verify — `{code}` (6 digits from the app) or `{recoveryCode}` (single use)
 * → this session passes the second factor for 96 h, and this browser is remembered.
 */
export const POST = route(
  { methods: ['POST'], access: 'moderator', mfa: false, rateLimit: RL.totpVerify, body },
  async ({ user, session, body, requestId }) => {
    const r = await verifyTotp(user, session, body, { requestId });
    const res = NextResponse.json({
      verifiedUntil: mfaVerifiedUntil(r.mfaAt).toISOString(),
      method: r.method,
      recoveryLeft: r.recoveryLeft,
    });
    rememberDevice(res, user, r.mfaAt);
    return res;
  },
);
