import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { bingoCallInput } from '@/server/admin/input';
import { callItem } from '@/server/bingo/bingo';

/**
 * POST /api/v1/admin/bingo/calls — `{position, called}`: an item happened (or the call is taken
 * back). New bingos are found and announced on the overlay and in chat.
 */
export const POST = route<'moderator', typeof bingoCallInput>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: bingoCallInput },
  async ({ user, requestId, body }) =>
    callItem({ actor: user, requestId }, body.position, body.called),
);
