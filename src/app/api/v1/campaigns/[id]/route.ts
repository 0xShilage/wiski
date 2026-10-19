import { getPublicCampaign } from '@/server/catalog/read';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/campaigns/[id] — public progress of a campaign (cached 5 s, 11 §8). */
export const GET = route<'public', undefined, undefined, { id: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.catalogRead },
  async ({ params }) => {
    const campaign = await getPublicCampaign(uuidParam(params.id));
    if (!campaign) throw Problems.notFound();
    return Response.json({ campaign }, { headers: { 'cache-control': 'public, max-age=5' } });
  },
);
