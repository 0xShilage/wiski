import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { csrfTokenFor } from '@/server/security/csrf';
import { resolveAvatarKey } from '@/lib/avatars';

/** GET /api/v1/me — own profile, role, onboarding state, CSRF token. */
export const GET = route(
  { methods: ['GET'], access: 'user', rateLimit: RL.account },
  async ({ user, session }) => ({
    id: user.id,
    username: user.username,
    avatarKey: resolveAvatarKey(user.avatarKey),
    role: user.role,
    isVip: user.isVip,
    status: user.status,
    onboarded: user.username !== null,
    memberSince: user.createdAt.toISOString(),
    csrfToken: csrfTokenFor(session.id),
  }),
);
