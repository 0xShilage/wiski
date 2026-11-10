import { sessionPostponeInput } from '@/server/admin/input';
import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { postponeSessions } from '@/server/live/schedule';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/admin/sessions/[id]/postpone — `{expectedVersion, days, cascade}`: "Adiar"
 * (2026-11-10) moves this planned session N days later, and with `cascade` every planned session
 * after it too.
 */
export const POST = route<'moderator', typeof sessionPostponeInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: sessionPostponeInput },
  async ({ body, user, requestId, params }) =>
    postponeSessions({ actor: user, requestId }, uuidParam(params.id), body),
);
