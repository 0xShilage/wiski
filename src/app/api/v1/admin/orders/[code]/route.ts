import { route } from '@/server/http/route';
import { getAdminOrder } from '@/server/orders/admin';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/admin/orders/[code] — order detail for staff (no full e-mail, no Pix payload). */
export const GET = route<'moderator', undefined, undefined, { code: string }>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async ({ user, params }) => ({ order: await getAdminOrder(params.code, user) }),
);
