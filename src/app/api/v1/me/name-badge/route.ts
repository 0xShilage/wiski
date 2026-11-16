import { z } from 'zod';
import { setNameBadge } from '@/server/community/name-badge';
import { HttpError } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

const choice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('role') }).strict(),
  z
    .object({
      kind: z.literal('emblem'),
      slug: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[a-z0-9-]+$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('achievement'),
      id: z
        .string()
        .min(1)
        .max(40)
        .regex(/^[a-z0-9-]+$/),
    })
    .strict(),
]);

/**
 * PUT /api/v1/me/name-badge — "Emblema ao lado do nome" (2026-11-15): the badge shown next to the
 * viewer's @username (one of their event badges or conquistas, or their staff role; `none` clears).
 */
export const PUT = route(
  {
    methods: ['PUT'],
    access: 'user',
    rateLimit: RL.profileWrite,
    body: z.object({ choice }).strict(),
  },
  async ({ user, body, requestId }) => {
    if (user.username === null)
      throw new HttpError(409, 'NOT_ONBOARDED', 'Crie seu perfil primeiro.');
    await setNameBadge(user, body.choice, requestId);
    return { ok: true };
  },
);
