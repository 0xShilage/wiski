import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { roletaSpinInput } from '@/server/admin/input';
import { spinRoleta } from '@/server/roleta/roleta';

/**
 * POST /api/v1/roleta/spin — one spin (5 a day, renewed at 17:00 BRT, not cumulative). The server
 * draws the prize; the answer says which slice the wheel stops on.
 */
export const POST = route<'user', typeof roletaSpinInput>(
  { methods: ['POST'], access: 'user', rateLimit: RL.roletaSpin, body: roletaSpinInput },
  async ({ user, requestId }) => spinRoleta(user, requestId),
);
