import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { staffBingo } from '@/server/bingo/bingo';

/** GET /api/v1/admin/bingo — today's items, calls, card count and winners (Admin › Bingo). */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => staffBingo(),
);
