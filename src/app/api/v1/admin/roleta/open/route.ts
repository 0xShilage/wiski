import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { roletaOpenInput } from '@/server/admin/input';
import { setRoletaOpen } from '@/server/roleta/roleta';

/**
 * PUT /api/v1/admin/roleta/open — `{open}`: the wheel on or off for everyone (moderators and the
 * streamer). Google step-up like the other site switches (`settings.update`; pentest 2026-11-04
 * L-R1, closed 2026-11-11).
 */
export const PUT = route<'moderator', typeof roletaOpenInput>(
  {
    methods: ['PUT'],
    access: 'moderator',
    rateLimit: RL.adminWrite,
    stepUp: true,
    body: roletaOpenInput,
  },
  async ({ user, requestId, body }) => setRoletaOpen({ actor: user, requestId }, body.open),
);
