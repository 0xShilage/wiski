import { badgeInput, createBadge } from '@/server/badges/badges';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/admin/badges — create a time-limited badge (Emblemas, 2026-11-12). */
export const POST = route<'moderator', typeof badgeInput>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: badgeInput },
  async ({ user, requestId, body }) => {
    const b = await createBadge({ actor: user, requestId }, body);
    return Response.json({ id: b.id, slug: b.slug }, { status: 201 });
  },
);
