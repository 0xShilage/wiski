import { badgeInput, deleteBadge, updateBadge } from '@/server/badges/badges';
import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** PATCH /api/v1/admin/badges/[id] — edit a badge (the whole form; `code` omitted: unchanged). */
export const PATCH = route<'moderator', typeof badgeInput, undefined, { id: string }>(
  { methods: ['PATCH'], access: 'moderator', rateLimit: RL.adminWrite, body: badgeInput },
  async ({ user, requestId, body, params }) => {
    const b = await updateBadge({ actor: user, requestId }, uuidParam(params.id), body);
    return { id: b.id, slug: b.slug };
  },
);

/** DELETE /api/v1/admin/badges/[id] — only a badge nobody has claimed. */
export const DELETE = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId, params }) => {
    await deleteBadge({ actor: user, requestId }, uuidParam(params.id));
    return new Response(null, { status: 204 });
  },
);
