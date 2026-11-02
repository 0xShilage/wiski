import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { setLike } from '@/server/reviews/write';

/** PUT /api/v1/reviews/[id]/like — idempotent like; never your own review. */
export const PUT = route<'user', undefined, undefined, { id: string }>(
  { methods: ['PUT'], access: 'user', rateLimit: RL.like },
  async ({ params, user }) => setLike(user, uuidParam(params.id), true),
);

/** DELETE /api/v1/reviews/[id]/like — idempotent unlike. */
export const DELETE = route<'user', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'user', rateLimit: RL.like },
  async ({ params, user }) => setLike(user, uuidParam(params.id), false),
);
