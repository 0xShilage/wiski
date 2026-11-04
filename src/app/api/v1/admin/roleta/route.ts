import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { roletaQuery } from '@/server/admin/input';
import { listRoletaPrizes } from '@/server/roleta/roleta';

/** GET /api/v1/admin/roleta?status=&before= — what viewers won (never the "Nada" spins). */
export const GET = route<'moderator', undefined, typeof roletaQuery>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin, query: roletaQuery },
  async ({ query }) => listRoletaPrizes({ status: query.status, before: query.before }),
);
