import { startTotpSetup } from '@/server/auth/totp';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/me/totp/setup — a new authenticator secret + QR code (waits 10 min for the first
 * code). Needs a fresh Google login; if the account already has a second factor, that factor too.
 */
export const POST = route(
  { methods: ['POST'], access: 'moderator', mfa: false, stepUp: true, rateLimit: RL.totpManage },
  async ({ user, session }) => startTotpSetup(user, session),
);
