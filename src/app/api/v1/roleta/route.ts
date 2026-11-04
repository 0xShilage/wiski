import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { myRoleta } from '@/server/roleta/roleta';

/** GET /api/v1/roleta — the signed-in viewer's spins left, next renewal and prizes. */
export const GET = route<'user'>(
  { methods: ['GET'], access: 'user', rateLimit: RL.publicRead },
  async ({ user }) => myRoleta(user.id),
);
