import { saveItemInput } from '@/server/catalog/input';
import { getAdmin } from '@/server/catalog/read';
import { deleteDraft, saveItem } from '@/server/catalog/service';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

type P = { id: string };

/** GET /api/v1/admin/catalog/items/[id] — editor data, price/goal formula, missing fields, history. */
export const GET = route<'moderator', undefined, undefined, P>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async ({ params }) => {
    const item = await getAdmin(uuidParam(params.id));
    if (!item) throw Problems.notFound();
    return { item };
  },
);

/** PATCH /api/v1/admin/catalog/items/[id] — save (expectedVersion → 409 on a concurrent save). */
export const PATCH = route<'moderator', typeof saveItemInput, undefined, P>(
  { methods: ['PATCH'], access: 'moderator', rateLimit: RL.adminWrite, body: saveItemInput },
  async ({ user, requestId, params, body }) => {
    const id = uuidParam(params.id);
    await saveItem({ actor: user, requestId }, id, body.expectedVersion, body.fields);
    return { item: await getAdmin(id) };
  },
);

/** DELETE /api/v1/admin/catalog/items/[id] — only drafts that never went live. */
export const DELETE = route<'moderator', undefined, undefined, P>(
  { methods: ['DELETE'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId, params }) => {
    await deleteDraft({ actor: user, requestId }, uuidParam(params.id));
    return new Response(null, { status: 204 });
  },
);
