import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { linkUpdateInput } from '@/server/admin/input';
import { deleteLink, updateLink } from '@/server/links/links';

/** PATCH /api/v1/admin/links/[id] — edit a link or show/hide it. */
export const PATCH = route<'moderator', typeof linkUpdateInput, undefined, { id: string }>(
  { methods: ['PATCH'], access: 'moderator', rateLimit: RL.adminWrite, body: linkUpdateInput },
  async ({ user, requestId, body, params }) =>
    updateLink({ actor: user, requestId }, uuidParam(params.id), body),
);

/** DELETE /api/v1/admin/links/[id] — remove a link (the others close the gap). */
export const DELETE = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId, params }) => {
    await deleteLink({ actor: user, requestId }, uuidParam(params.id));
    return new Response(null, { status: 204 });
  },
);
