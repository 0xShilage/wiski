import { getAdmin } from '@/server/catalog/read';
import { registerWatchedOffStream } from '@/server/catalog/service';
import { watchedOffStreamInput } from '@/server/catalog/input';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/admin/catalog/items/[id]/watched-offstream — `{expectedVersion, watchedOn}`:
 * "Registrar como assistido (fora da live)" (2026-11-10). A draft Iara watched by herself goes
 * straight to Assistidos. `watchedOn` is a date (noon São Paulo) or null for today.
 */
export const POST = route<'moderator', typeof watchedOffStreamInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: watchedOffStreamInput },
  async ({ body, user, requestId, params }) => {
    const id = uuidParam(params.id);
    const at = body.watchedOn ? new Date(`${body.watchedOn}T15:00:00.000Z`) : null;
    await registerWatchedOffStream({ actor: user, requestId }, id, body.expectedVersion, at);
    return { item: await getAdmin(id) };
  },
);
