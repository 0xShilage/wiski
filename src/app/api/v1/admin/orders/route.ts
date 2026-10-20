import { z } from 'zod';
import { route } from '@/server/http/route';
import { ADMIN_FILTERS, adminCountsByFilter, listAdminOrders } from '@/server/orders/admin';
import { RL } from '@/server/ratelimit/rules';

const query = z
  .object({
    filtro: z.enum(Object.keys(ADMIN_FILTERS) as [keyof typeof ADMIN_FILTERS]).default('todos'),
    q: z.string().max(80).optional(),
    cursor: z.uuid().optional(),
  })
  .strict();

/** GET /api/v1/admin/orders — /admin/pedidos list (MODERATOR+, passkey), newest first. */
export const GET = route(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin, query },
  async ({ query }) => ({
    counts: await adminCountsByFilter(),
    ...(await listAdminOrders({
      filter: query.filtro,
      q: query.q ?? null,
      cursor: query.cursor ?? null,
    })),
  }),
);
