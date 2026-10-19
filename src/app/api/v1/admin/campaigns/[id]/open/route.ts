import { openCampaign } from '@/server/catalog/campaigns';
import { openCampaignInput } from '@/server/catalog/input';
import { getAdmin } from '@/server/catalog/read';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/admin/campaigns/[id]/open — STREAMER opens a prepared series/franchise
 * (goal + deadline). `[id]` is the catalog item: the campaign is created by opening it.
 * Money action → passkey AND a fresh Google login (step-up).
 */
export const POST = route<'streamer', typeof openCampaignInput, undefined, { id: string }>(
  {
    methods: ['POST'],
    access: 'streamer',
    stepUp: true,
    rateLimit: RL.adminWrite,
    body: openCampaignInput,
  },
  async ({ user, requestId, params, body }) => {
    const id = uuidParam(params.id);
    await openCampaign({ actor: user, requestId }, id, body);
    return Response.json({ item: await getAdmin(id) }, { status: 201 });
  },
);
