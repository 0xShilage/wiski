import { getPublic } from '@/server/catalog/read';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { apiKindParam, slugParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/catalog/{kind}/[slug] — one live (or already watched) item. */
export const GET = route<'public', undefined, undefined, { kind: string; slug: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.catalogRead },
  async ({ params }) => {
    const item = await getPublic(apiKindParam(params.kind), slugParam(params.slug));
    if (!item) throw Problems.notFound();
    return Response.json({ item }, { headers: { 'cache-control': 'public, max-age=15' } });
  },
);
