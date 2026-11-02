import { codeParam, loadVisibleOrder, orderView } from '@/server/checkout/access';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * GET /api/v1/orders/[code] — the order page's data: status, breakdown, and the Pix while unpaid.
 * Owner session, the order cookie, or a moderator; anyone else gets 404 (03 §5.3).
 */
export const GET = route<'public', undefined, undefined, { code: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.orderRead },
  async ({ req, user, params }) => {
    const { order, viewer } = await loadVisibleOrder(codeParam(params.code), user, req);
    return orderView(order, viewer, user, req);
  },
);
