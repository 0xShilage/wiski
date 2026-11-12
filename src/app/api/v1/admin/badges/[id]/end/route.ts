import { endBadge } from '@/server/badges/badges';
import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/admin/badges/[id]/end — close the claim window now. */
export const POST = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId, params }) => {
    const b = await endBadge({ actor: user, requestId }, uuidParam(params.id));
    return { id: b.id, endsAt: b.endsAt.toISOString() };
  },
);
