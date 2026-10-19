import { z } from 'zod';
import { completeOnboarding } from '@/server/auth/accounts';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { avatarKeySchema } from '@/lib/avatars';
import { usernameSchema } from '@/lib/username';

/** POST /api/v1/me/onboarding — `{username, avatarKey}` once, after the first login. */
export const POST = route(
  {
    methods: ['POST'],
    access: 'user',
    rateLimit: RL.profileWrite,
    body: z.object({ username: usernameSchema, avatarKey: avatarKeySchema }).strict(),
  },
  async ({ user, body, requestId }) => {
    await completeOnboarding(user, body, requestId);
    return { ok: true, username: body.username };
  },
);
