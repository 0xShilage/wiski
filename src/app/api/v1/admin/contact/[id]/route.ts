import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { contactStatusInput } from '@/server/admin/input';
import { deleteContact, setContactStatus } from '@/server/contact/contact';

/** PATCH /api/v1/admin/contact/[id] — mark read / archived / spam. */
export const PATCH = route<'moderator', typeof contactStatusInput, undefined, { id: string }>(
  { methods: ['PATCH'], access: 'moderator', rateLimit: RL.adminWrite, body: contactStatusInput },
  async ({ user, requestId, body, params }) => {
    await setContactStatus({ actor: user, requestId }, uuidParam(params.id), body.status);
    return { ok: true };
  },
);

/** DELETE /api/v1/admin/contact/[id] — delete a message. */
export const DELETE = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId, params }) => {
    await deleteContact({ actor: user, requestId }, uuidParam(params.id));
    return new Response(null, { status: 204 });
  },
);
