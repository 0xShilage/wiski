import { route } from '@/server/http/route';
import { currentLegal } from '@/server/legal/legal';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/legal/current — current versions + hashes of terms, privacy and refund policy. */
export const GET = route(
  { methods: ['GET'], access: 'public', rateLimit: RL.catalogRead },
  async () =>
    Response.json(
      { legal: currentLegal() },
      { headers: { 'cache-control': 'public, max-age=60' } },
    ),
);
