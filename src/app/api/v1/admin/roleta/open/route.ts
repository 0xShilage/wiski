import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { roletaOpenInput } from '@/server/admin/input';
import { setRoletaOpen } from '@/server/roleta/roleta';

/** PUT /api/v1/admin/roleta/open — `{open}`: the wheel on or off for everyone (streamer). */
export const PUT = route<'streamer', typeof roletaOpenInput>(
  { methods: ['PUT'], access: 'streamer', rateLimit: RL.adminWrite, body: roletaOpenInput },
  async ({ user, requestId, body }) => setRoletaOpen({ actor: user, requestId }, body.open),
);
