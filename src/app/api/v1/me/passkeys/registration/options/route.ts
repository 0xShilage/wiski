import { registrationOptions } from '@/server/auth/passkeys';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/me/passkeys/registration/options — start enrolling a passkey (MODERATOR+).
 * Needs a fresh Google login (step-up): a stolen session cookie alone must not be able to add
 * an attacker's authenticator.
 */
export const POST = route(
  { methods: ['POST'], access: 'moderator', mfa: false, stepUp: true, rateLimit: RL.passkey },
  async ({ user, session }) => ({ options: await registrationOptions(user, session) }),
);
