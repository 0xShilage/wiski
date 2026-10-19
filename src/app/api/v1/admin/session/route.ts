import { countPasskeys, isMfaFresh } from '@/server/auth/passkeys';
import { isStepUpFresh } from '@/server/auth/step-up';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * GET /api/v1/admin/session — MODERATOR+ probe for the admin shell: role, Google step-up
 * freshness and the passkey state (enrolled? verified in the last 10 min?). It is the one admin
 * route that does not itself require the passkey — it tells the UI which prompt to show.
 */
export const GET = route(
  { methods: ['GET'], access: 'moderator', mfa: false, rateLimit: RL.admin },
  async ({ user, session }) => ({
    role: user.role,
    stepUpFresh: isStepUpFresh(session),
    passkey: { enrolled: (await countPasskeys(user.id)) > 0, verified: isMfaFresh(session) },
  }),
);
