import { gameInput } from '@/server/admin/input';
import { createGame, listGames } from '@/server/games/games';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/admin/games — every game on /jogos (2026-11-09). */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => ({ games: await listGames() }),
);

/** POST /api/v1/admin/games — add a game. */
export const POST = route<'moderator', typeof gameInput>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: gameInput },
  async ({ user, requestId, body }) =>
    Response.json({ game: await createGame({ actor: user, requestId }, body) }, { status: 201 }),
);
