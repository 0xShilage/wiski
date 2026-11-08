import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { roletaStatusInput } from '@/server/admin/input';
import { setRoletaStatus } from '@/server/roleta/roleta';

/**
 * PATCH /api/v1/admin/roleta/[id] — mark a prize delivered, back to waiting, or
 * cancelled; compare-and-set on the status staff saw.
 */
export const PATCH = route<'moderator', typeof roletaStatusInput, undefined, { id: string }>(
  { methods: ['PATCH'], access: 'moderator', rateLimit: RL.adminWrite, body: roletaStatusInput },
  async ({ user, requestId, body, params }) => {
    await setRoletaStatus({ actor: user, requestId }, uuidParam(params.id), body);
    return { ok: true };
  },
);
