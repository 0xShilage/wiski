import { listPublic } from '@/server/catalog/read';
import { route } from '@/server/http/route';
import { apiKindParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/catalog/{movies|series|franchises} — live items in slot order (11 §8). */
export const GET = route<'public', undefined, undefined, { kind: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.catalogRead },
  async ({ params }) => {
    const items = await listPublic(apiKindParam(params.kind));
    return Response.json({ items }, { headers: { 'cache-control': 'public, max-age=15' } });
  },
);
