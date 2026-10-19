import { revertInput } from '@/server/catalog/input';
import { getAdmin } from '@/server/catalog/read';
import { revertItem } from '@/server/catalog/service';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/admin/catalog/items/[id]/revert — restore a version's content as a new save. */
export const POST = route<'moderator', typeof revertInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: revertInput },
  async ({ user, requestId, params, body }) => {
    const id = uuidParam(params.id);
    await revertItem({ actor: user, requestId }, id, body.expectedVersion, body.toVersion);
    return { item: await getAdmin(id) };
  },
);
