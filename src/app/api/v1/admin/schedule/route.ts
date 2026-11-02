import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { scheduleInput } from '@/server/admin/input';
import { complete, nowPlaying, schedule, unschedule } from '@/server/live/schedule';

/**
 * POST /api/v1/admin/schedule — `{action: add|remove|now|complete, target: {kind, id,
 * expectedVersion}, sessionId?}`: put a paid movie / funded campaign on a session, take it off,
 * "Agora assistindo", "Concluído" (→ watched, reviews open).
 */
export const POST = route<'moderator', typeof scheduleInput>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: scheduleInput },
  async ({ body, user, requestId }) => {
    const ctx = { actor: user, requestId };
    if (body.action === 'add') await schedule(ctx, body.target, body.sessionId);
    else if (body.action === 'remove') await unschedule(ctx, body.target);
    else if (body.action === 'now') await nowPlaying(ctx, body.target);
    else await complete(ctx, body.target);
    return { ok: true };
  },
);
