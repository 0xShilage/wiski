import { getAdmin } from '@/server/catalog/read';
import { markWatched } from '@/server/catalog/service';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/admin/catalog/items/[id]/watched — watched on stream → reviews unlock. */
export const POST = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId, params }) => {
    const id = uuidParam(params.id);
    await markWatched({ actor: user, requestId }, id);
    return { item: await getAdmin(id) };
  },
);
