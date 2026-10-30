import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { cursorQuery } from '@/server/reviews/input';
import { findProfile, userReviews } from '@/server/reviews/read';

/** GET /api/v1/users/[username]/reviews?cursor= — that person's visible reviews, newest first. */
export const GET = route<'public', undefined, typeof cursorQuery, { username: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.reviewRead, query: cursorQuery },
  async ({ params, query, user }) => {
    const p = await findProfile(String(params.username ?? ''));
    if (!p) throw Problems.notFound();
    return userReviews(p.id, query.cursor, user?.id);
  },
);
