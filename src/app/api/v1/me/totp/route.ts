import { disableTotp } from '@/server/auth/totp';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * DELETE /api/v1/me/totp — turn the authenticator off (fresh second factor + Google login).
 * Remembered browsers are forgotten; without a passkey the panel asks to set up 2FA again.
 */
export const DELETE = route(
  { methods: ['DELETE'], access: 'moderator', stepUp: true, rateLimit: RL.totpManage },
  async ({ user, requestId }) => {
    await disableTotp(user, { requestId });
    return new Response(null, { status: 204 });
  },
);
