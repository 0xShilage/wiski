import { publishInput } from '@/server/catalog/input';
import { getAdmin } from '@/server/catalog/read';
import { publishMovie } from '@/server/catalog/service';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/admin/catalog/items/[id]/publish — a complete movie draft goes live (11 §4). */
export const POST = route<'moderator', typeof publishInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: publishInput },
  async ({ user, requestId, params, body }) => {
    const id = uuidParam(params.id);
    await publishMovie({ actor: user, requestId }, id, body.expectedVersion, body.slot);
    return { item: await getAdmin(id) };
  },
);
