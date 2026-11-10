import { gameUpdateInput } from '@/server/admin/input';
import { deleteGame, updateGame } from '@/server/games/games';
import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** PATCH /api/v1/admin/games/[id] — `{expectedVersion, …every field}`: edit a game. */
export const PATCH = route<'moderator', typeof gameUpdateInput, undefined, { id: string }>(
  { methods: ['PATCH'], access: 'moderator', rateLimit: RL.adminWrite, body: gameUpdateInput },
  async ({ user, requestId, body, params }) => {
    const { expectedVersion, ...input } = body;
    return {
      game: await updateGame(
        { actor: user, requestId },
        uuidParam(params.id),
        expectedVersion,
        input,
      ),
    };
  },
);

/** DELETE /api/v1/admin/games/[id] — remove a game from /jogos. */
export const DELETE = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['DELETE'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId, params }) => {
    await deleteGame({ actor: user, requestId }, uuidParam(params.id));
    return new Response(null, { status: 204 });
  },
);
