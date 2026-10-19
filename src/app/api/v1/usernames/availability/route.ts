import { z } from 'zod';
import { isUsernameAvailable } from '@/server/auth/accounts';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { normalizeUsername, usernameRuleViolation } from '@/lib/username';

/** GET /api/v1/usernames/availability?u= — `{available}` only (tight rate limit). */
export const GET = route(
  {
    methods: ['GET'],
    access: 'user',
    rateLimit: RL.usernameAvailability,
    query: z.object({ u: z.string().min(1).max(64) }).strict(),
  },
  async ({ user, query }) => {
    const name = normalizeUsername(query.u);
    if (usernameRuleViolation(name) !== null) return { available: false };
    return { available: await isUsernameAvailable(name, user.id) };
  },
);
