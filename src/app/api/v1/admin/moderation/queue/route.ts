import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { moderationQueue } from '@/server/reviews/moderation';

/** GET /api/v1/admin/moderation/queue — held and reported reviews, hidden ones, brigading signals. */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => moderationQueue(),
);
