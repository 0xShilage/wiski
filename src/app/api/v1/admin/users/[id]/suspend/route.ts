import { isStepUpFresh, stepUpUrl } from '@/server/auth/step-up';
import { uuidParam } from '@/server/http/params';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { suspendInput } from '@/server/admin/input';
import { MODERATOR_MAX_SUSPENSION_DAYS, suspendUser } from '@/server/users/admin';

/**
 * POST /api/v1/admin/users/[id]/suspend — `{days}` (1–7 for moderators) or `{days: null}` /
 * longer (streamer, with Google step-up).
 */
export const POST = route<'moderator', typeof suspendInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: suspendInput },
  async ({ params, user, requestId, body, session }) => {
    const long = body.days === null || body.days > MODERATOR_MAX_SUSPENSION_DAYS;
    if (long && user.role === 'STREAMER' && !isStepUpFresh(session)) {
      throw Problems.stepUpRequired(stepUpUrl('/admin/usuarios'));
    }
    return { user: await suspendUser({ actor: user, requestId }, uuidParam(params.id), body.days) };
  },
);
