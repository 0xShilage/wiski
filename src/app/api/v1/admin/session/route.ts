import { factorsOf, hasFactor, isMfaFresh } from '@/server/auth/mfa';
import { isStepUpFresh } from '@/server/auth/step-up';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * GET /api/v1/admin/session — MODERATOR+ probe for the admin shell: role, Google step-up
 * freshness and the second-factor state (set up? which methods? checked in the last 96 h?). It is
 * the one admin route that does not itself require the second factor — it tells the UI which
 * prompt to show.
 */
export const GET = route(
  { methods: ['GET'], access: 'moderator', mfa: false, rateLimit: RL.admin },
  async ({ user, session }) => {
    const f = await factorsOf(user.id);
    return {
      role: user.role,
      stepUpFresh: isStepUpFresh(session),
      mfa: {
        enrolled: hasFactor(f),
        totp: f.totp,
        passkeys: f.passkeys,
        verified: isMfaFresh(session),
      },
    };
  },
);
