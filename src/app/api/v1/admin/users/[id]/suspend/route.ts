import { factorList, factorsOf } from '@/server/auth/mfa';
import { isStepUpFresh, stepUpUrl } from '@/server/auth/step-up';
import { uuidParam } from '@/server/http/params';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { suspendInput } from '@/server/admin/input';
import { STEP_UP_SUSPENSION_DAYS, suspendUser } from '@/server/users/admin';

/**
 * POST /api/v1/admin/users/[id]/suspend — `{days}`; `{days: null}` or longer than 7 days needs a
 * fresh Google confirmation (moderators and the streamer alike, 2026-11-08).
 */
export const POST = route<'moderator', typeof suspendInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: suspendInput },
  async ({ params, user, requestId, body, session }) => {
    const long = body.days === null || body.days > STEP_UP_SUSPENSION_DAYS;
    if (long && !isStepUpFresh(session)) {
      throw Problems.stepUpRequired(
        stepUpUrl('/admin/pessoas'),
        factorList(await factorsOf(user.id)),
      );
    }
    return { user: await suspendUser({ actor: user, requestId }, uuidParam(params.id), body.days) };
  },
);
