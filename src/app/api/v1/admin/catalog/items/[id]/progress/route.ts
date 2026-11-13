import { z } from 'zod';
import { getAdmin } from '@/server/catalog/read';
import { setMarathonProgress } from '@/server/catalog/service';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

const body = z.object({ from: z.int().min(0).max(100), to: z.int().min(0).max(100) }).strict();

/**
 * POST /api/v1/admin/catalog/items/[id]/progress — the marathon trail moves one stop (2026-11-13):
 * `{from, to}` with the count the moderator saw.
 */
export const POST = route<'moderator', typeof body, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body },
  async ({ user, requestId, params, body: b }) => {
    const id = uuidParam(params.id);
    await setMarathonProgress({ actor: user, requestId }, id, b.from, b.to);
    return { item: await getAdmin(id) };
  },
);
