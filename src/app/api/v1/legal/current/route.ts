import { currentLegal } from '@/server/checkout/status';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/legal/current — the versions a buyer accepts at checkout (03 §5.3). */
export const GET = route(
  { methods: ['GET'], access: 'public', rateLimit: RL.legalRead },
  async () => {
    const legal = await currentLegal();
    return Response.json(
      {
        legal: legal
          ? {
              terms: legal.TERMS.version,
              privacy: legal.PRIVACY.version,
              refund: legal.REFUND.version,
            }
          : null,
      },
      { headers: { 'cache-control': 'public, max-age=60' } },
    );
  },
);
