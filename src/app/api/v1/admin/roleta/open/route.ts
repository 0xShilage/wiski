import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { roletaOpenInput } from '@/server/admin/input';
import { setRoletaOpen } from '@/server/roleta/roleta';

/** PUT /api/v1/admin/roleta/open — `{open}`: the wheel on or off for everyone (streamer). */
export const PUT = route<'moderator', typeof roletaOpenInput>(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: roletaOpenInput },
  async ({ user, requestId, body }) => setRoletaOpen({ actor: user, requestId }, body.open),
);
