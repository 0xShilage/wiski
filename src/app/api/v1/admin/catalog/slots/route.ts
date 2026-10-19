import { slotsInput } from '@/server/catalog/input';
import { reorderSlots } from '@/server/catalog/service';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** PUT /api/v1/admin/catalog/slots — reorder the slot board (one transaction, checked at commit). */
export const PUT = route(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: slotsInput },
  async ({ user, requestId, body }) =>
    reorderSlots({ actor: user, requestId }, body.kind, body.slots),
);
