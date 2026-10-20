import { extendCampaign } from '@/server/catalog/campaigns';
import { queueExtensionNotices } from '@/server/email/outbox';
import { extendCampaignInput } from '@/server/catalog/input';
import { getAdmin } from '@/server/catalog/read';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/** POST /api/v1/admin/campaigns/[id]/extend — new deadline (shown publicly). `[id]` = item id. */
export const POST = route<'streamer', typeof extendCampaignInput, undefined, { id: string }>(
  {
    methods: ['POST'],
    access: 'streamer',
    stepUp: true,
    rateLimit: RL.adminWrite,
    body: extendCampaignInput,
  },
  async ({ user, requestId, params, body }) => {
    const id = uuidParam(params.id);
    const c = await extendCampaign({ actor: user, requestId }, id, body.days);
    // contributors with an e-mail get a notice (11 §2.2) — after commit, idempotent per extension
    await queueExtensionNotices(c.id, c.extensions);
    return { item: await getAdmin(id) };
  },
);
