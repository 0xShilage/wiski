import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { bingoItemsInput } from '@/server/admin/input';
import { setBingoItems } from '@/server/bingo/bingo';

/** PUT /api/v1/admin/bingo/items — `{items}`: the 18 items' texts, in position order. */
export const PUT = route<'moderator', typeof bingoItemsInput>(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: bingoItemsInput },
  async ({ user, requestId, body }) => ({
    items: await setBingoItems({ actor: user, requestId }, body.items),
  }),
);
