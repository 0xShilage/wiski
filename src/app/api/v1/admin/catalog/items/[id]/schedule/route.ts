import { scheduleInput } from '@/server/catalog/input';
import { scheduleMovie } from '@/server/catalog/publishing';
import { getAdmin } from '@/server/catalog/read';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/**
 * PUT /api/v1/admin/catalog/items/[id]/schedule — a complete movie draft goes live on its own
 * at `publishAt` (2026-11-15); `publishAt: null` cancels.
 */
export const PUT = route<'moderator', typeof scheduleInput, undefined, { id: string }>(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: scheduleInput },
  async ({ user, requestId, params, body }) => {
    const id = uuidParam(params.id);
    await scheduleMovie({ actor: user, requestId }, id, body);
    return { item: await getAdmin(id) };
  },
);
