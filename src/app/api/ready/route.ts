import { db } from '@/server/db';
import { HttpError } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { redis } from '@/server/redis';

/**
 * Readiness for the container healthcheck. Reachable only from the Docker network (nginx
 * `deny all` for /api/ready in Phase 5). Reports only up/down.
 */
export const GET = route({ methods: ['GET'], access: 'public' }, async () => {
  const [dbOk, redisOk] = await Promise.all([
    db().$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    redis()
      .ping()
      .then((r) => r === 'PONG')
      .catch(() => false),
  ]);
  if (!dbOk || !redisOk) throw new HttpError(503, 'NOT_READY', 'Indisponível.');
  return { status: 'ready' };
});
