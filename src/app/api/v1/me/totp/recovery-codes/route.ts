import { NextResponse } from 'next/server';
import { regenerateRecoveryCodes } from '@/server/auth/totp';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/me/totp/recovery-codes — a new set of 6 (the old ones stop working). */
export const POST = route(
  { methods: ['POST'], access: 'moderator', stepUp: true, rateLimit: RL.totpManage },
  async ({ user, requestId }) =>
    NextResponse.json(
      { recoveryCodes: await regenerateRecoveryCodes(user, { requestId }) },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    ),
);
