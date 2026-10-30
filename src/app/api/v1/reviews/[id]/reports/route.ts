import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { reportInput } from '@/server/reviews/input';
import { reportReview } from '@/server/reviews/write';

/**
 * POST /api/v1/reviews/[id]/reports — `{reason, note?}`; one per user per review (repeats answer
 * the same); account ≥ 24 h old. Three reports from accounts ≥ 7 days old hide the review until a
 * moderator looks (Q15).
 */
export const POST = route<'user', typeof reportInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'user', rateLimit: RL.report, body: reportInput },
  async ({ params, body, user, audit }) => reportReview(user, uuidParam(params.id), body, audit),
);
