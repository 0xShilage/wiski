import { versionInput } from '@/server/admin/input';
import { getAdmin } from '@/server/catalog/read';
import { unmarkWatched } from '@/server/catalog/service';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/admin/catalog/items/[id]/unwatched — `{expectedVersion}`: "Desmarcar assistido"
 * (2026-11-09); the title and its order or campaign go back to the queue.
 */
export const POST = route<'moderator', typeof versionInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: versionInput },
  async ({ body, user, requestId, params }) => {
    const id = uuidParam(params.id);
    await unmarkWatched({ actor: user, requestId }, id, body.expectedVersion);
    return { item: await getAdmin(id) };
  },
);
