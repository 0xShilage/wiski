import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { bingoCardInput } from '@/server/admin/input';
import { takeCard } from '@/server/bingo/bingo';

/**
 * POST /api/v1/bingo/card — today's card (one a day, renewed at 16:00 BRT): drawn by the server the
 * first time, the same one after that. `place` is set when the card already has a line.
 */
export const POST = route<'user', typeof bingoCardInput>(
  { methods: ['POST'], access: 'user', rateLimit: RL.bingoCard, body: bingoCardInput },
  async ({ user }) => takeCard(user),
);
