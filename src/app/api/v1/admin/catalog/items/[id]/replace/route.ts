import { replaceInput } from '@/server/catalog/input';
import { replaceItem } from '@/server/catalog/service';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/admin/catalog/items/[id]/replace — "Substituir": archive and free the slot. */
export const POST = route<'moderator', typeof replaceInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: replaceInput },
  async ({ user, requestId, params, body }) =>
    replaceItem({ actor: user, requestId }, uuidParam(params.id), body.replacementId),
);
