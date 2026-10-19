import { authenticationOptions } from '@/server/auth/passkeys';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/me/passkeys/authentication/options — challenge for the admin second factor. */
export const POST = route(
  { methods: ['POST'], access: 'moderator', mfa: false, rateLimit: RL.passkey },
  async ({ user, session }) => ({ options: await authenticationOptions(user, session) }),
);
