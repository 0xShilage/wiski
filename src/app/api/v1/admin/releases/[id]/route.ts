import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { releaseUpdateInput } from '@/server/admin/input';
import { deleteRelease, updateRelease } from '@/server/releases/releases';

/** PATCH /api/v1/admin/releases/[id] — edit a release. */
export const PATCH = route<'moderator', typeof releaseUpdateInput, undefined, { id: string }>(
  { methods: ['PATCH'], access: 'moderator', rateLimit: RL.adminWrite, body: releaseUpdateInput },
  async ({ user, requestId, body, params }) => {
    await updateRelease({ actor: user, requestId }, uuidParam(params.id), body);
    return { ok: true };
  },
);

/** DELETE /api/v1/admin/releases/[id] — remove a release. */
export const DELETE = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId, params }) => {
    await deleteRelease({ actor: user, requestId }, uuidParam(params.id));
    return new Response(null, { status: 204 });
  },
);
