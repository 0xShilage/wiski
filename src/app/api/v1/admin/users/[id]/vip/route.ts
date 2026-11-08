import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { vipInput } from '@/server/admin/input';
import { setVip } from '@/server/users/admin';

/** POST /api/v1/admin/users/[id]/vip — streamer: the 10 % VIP perk on or off. */
export const POST = route<'moderator', typeof vipInput, undefined, { id: string }>(
  {
    methods: ['POST'],
    access: 'moderator',
    stepUp: true,
    rateLimit: RL.adminWrite,
    body: vipInput,
  },
  async ({ params, user, requestId, body }) => ({
    user: await setVip({ actor: user, requestId }, uuidParam(params.id), body.vip),
  }),
);
