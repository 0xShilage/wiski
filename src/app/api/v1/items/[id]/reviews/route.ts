import { uuidParam } from '@/server/http/params';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { createReviewInput, listQuery } from '@/server/reviews/input';
import { itemReviews, ratingSummary, reviewableItem } from '@/server/reviews/read';
import { createReview } from '@/server/reviews/write';

/**
 * GET /api/v1/items/[id]/reviews?sort=recent|top&cursor= — visible reviews of a watched item
 * (spoilers flagged); the first page also carries the rating summary.
 */
export const GET = route<'public', undefined, typeof listQuery, { id: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.reviewRead, query: listQuery },
  async ({ params, query, user }) => {
    const id = uuidParam(params.id);
    if (!(await reviewableItem(id))) throw Problems.notFound();
    const page = await itemReviews(id, query.sort, query.cursor, user?.id);
    return query.cursor ? page : { ...page, summary: await ratingSummary(id) };
  },
);

/**
 * POST /api/v1/items/[id]/reviews — `{rating 1-5, body ≤ 2000, containsSpoilers}`; only once the
 * item was watched on stream; one per user per item (edit it afterwards). Turnstile.
 */
export const POST = route<'user', typeof createReviewInput, undefined, { id: string }>(
  {
    methods: ['POST'],
    access: 'user',
    rateLimit: [RL.reviewCreate, RL.reviewCreateDaily],
    turnstile: 'review',
    body: createReviewInput,
  },
  async ({ params, body, user }) => {
    const review = await createReview(user, uuidParam(params.id), body);
    return Response.json({ review }, { status: 201 });
  },
);
