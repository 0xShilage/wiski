import { z } from 'zod';
import { ITEM_KINDS } from '@/lib/catalog/kinds';
import { createItemInput } from '@/server/catalog/input';
import { adminCounts, getAdmin, listAdmin } from '@/server/catalog/read';
import { createItem } from '@/server/catalog/service';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

const query = z.object({ kind: z.enum(ITEM_KINDS) }).strict();

/** GET /api/v1/admin/catalog/items?kind=MOVIE — slot board + drafts, and the live counts. */
export const GET = route(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin, query },
  async ({ query }) => ({ counts: await adminCounts(), items: await listAdmin(query.kind) }),
);

/** POST /api/v1/admin/catalog/items — new draft (version 1, first revision). */
export const POST = route(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: createItemInput },
  async ({ user, requestId, body }) => {
    const item = await createItem({ actor: user, requestId }, body);
    return Response.json({ item: await getAdmin(item.id) }, { status: 201 });
  },
);
