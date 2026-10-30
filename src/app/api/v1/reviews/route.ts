import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { cursorQuery } from '@/server/reviews/input';
import { latestReviews } from '@/server/reviews/read';

/** GET /api/v1/reviews?cursor= — latest visible reviews across every title (Avaliações). */
export const GET = route<'public', undefined, typeof cursorQuery>(
  { methods: ['GET'], access: 'public', rateLimit: RL.reviewRead, query: cursorQuery },
  async ({ query, user }) => latestReviews(query.cursor, user?.id),
);
