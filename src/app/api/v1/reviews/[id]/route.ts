import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { editReviewInput } from '@/server/reviews/input';
import { deleteReview, editReview } from '@/server/reviews/write';

/** PATCH /api/v1/reviews/[id] — the author edits their review (shows "editado"). Others: 404. */
export const PATCH = route<'user', typeof editReviewInput, undefined, { id: string }>(
  { methods: ['PATCH'], access: 'user', rateLimit: RL.reviewEdit, body: editReviewInput },
  async ({ params, body, user }) => ({
    review: await editReview(user, uuidParam(params.id), body),
  }),
);

/**
 * DELETE /api/v1/reviews/[id] — the author deletes their review. Moderators act through
 * /api/v1/admin/moderation/reviews/[id] (passkey, audited), never here.
 */
export const DELETE = route<'user', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'user', rateLimit: RL.reviewEdit },
  async ({ params, user }) => {
    await deleteReview(user, uuidParam(params.id));
    return new Response(null, { status: 204 });
  },
);
