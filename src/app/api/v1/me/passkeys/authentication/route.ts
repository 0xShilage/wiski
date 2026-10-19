import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { MFA_MAX_AGE_SEC, verifyAuthentication } from '@/server/auth/passkeys';
import { authenticationResponseSchema } from '@/server/auth/passkey-schemas';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

const body = z.object({ response: authenticationResponseSchema }).strict();

/** POST /api/v1/me/passkeys/authentication — verify the assertion → Session.mfaAt = now. */
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
    return {
      verifiedUntil: new Date(mfaAt.getTime() + MFA_MAX_AGE_SEC * 1000).toISOString(),
    };
  },
);
