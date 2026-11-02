import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { mfaVerifiedUntil, rememberDevice } from '@/server/auth/mfa';
import { verifyAuthentication } from '@/server/auth/passkeys';
import { authenticationResponseSchema } from '@/server/auth/passkey-schemas';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

const body = z.object({ response: authenticationResponseSchema }).strict();

/** POST /api/v1/me/passkeys/authentication — verify the assertion → Session.mfaAt = now (96 h). */
export const POST = route(
  { methods: ['POST'], access: 'moderator', mfa: false, rateLimit: RL.passkey, body },
  async ({ user, session, body, audit }) => {
    const { passkeyId, mfaAt } = await verifyAuthentication(
      user,
      session,
      body.response as AuthenticationResponseJSON,
    );
    await audit({
      action: 'passkey.verify',
      targetType: 'Passkey',
      targetId: passkeyId,
      metadata: {},
    });
    const res = NextResponse.json({ verifiedUntil: mfaVerifiedUntil(mfaAt).toISOString() });
    rememberDevice(res, user, mfaAt);
    return res;
  },
);
