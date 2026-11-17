import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { myBingo } from '@/server/bingo/bingo';

/** GET /api/v1/bingo — today's items, calls and winners, and the signed-in viewer's card. */
export const GET = route<'user'>(
  { methods: ['GET'], access: 'user', rateLimit: RL.publicRead },
  async ({ user }) => myBingo(user.id),
);
