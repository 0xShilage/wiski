import { z } from 'zod';
import { deletePasskey } from '@/server/auth/passkeys';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

const params = z.object({ id: z.uuid() });

/** DELETE /api/v1/me/passkeys/[id] — remove one of my passkeys (fresh Google login required). */
export const DELETE = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'moderator', mfa: false, stepUp: true, rateLimit: RL.passkey },
  async ({ user, params: raw, audit }) => {
    const p = params.safeParse(raw);
    if (!p.success || !(await deletePasskey(user.id, p.data.id))) throw Problems.notFound();
    await audit({
      action: 'passkey.delete',
      targetType: 'Passkey',
      targetId: p.data.id,
      metadata: {},
    });
    return new Response(null, { status: 204 });
  },
);
