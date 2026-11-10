import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { scheduleInput } from '@/server/admin/input';
import { complete, nowPlaying, schedule, unschedule } from '@/server/live/schedule';
import {
  addEvent,
  addPart,
  completeSegment,
  removeSegment,
  segmentNow,
  setEventPoster,
} from '@/server/live/segments';

/**
 * POST /api/v1/admin/schedule — `{action: add|remove|now|complete, target: {kind, id,
 * expectedVersion}, sessionId?}`: put a paid movie / funded campaign on a session, take it off,
 * "Agora assistindo", "Concluído" (→ watched, reviews open).
 * 2026-11-04: `part` books a few episodes / one film of a funded campaign, `event` a custom
 * event; both are SEGMENT targets for remove / now / complete (`finish`: the last part).
 * 2026-11-09: an event may carry a poster (`posterId`); `event-poster` changes or removes it.
 */
export const POST = route<'moderator', typeof scheduleInput>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: scheduleInput },
  async ({ body, user, requestId }) => {
    const ctx = { actor: user, requestId };
    if (body.action === 'part') {
      const { action: _a, ...input } = body;
      return { segment: { id: (await addPart(ctx, input)).id } };
    }
    if (body.action === 'event') {
      const { action: _a, ...input } = body;
      return { segment: { id: (await addEvent(ctx, input)).id } };
    }
    if (body.action === 'event-poster') {
      const { id, expectedVersion } = body.target;
      await setEventPoster(ctx, { id, expectedVersion }, body.posterId);
      return { ok: true };
    }
    const t = body.target;
    if (t.kind === 'SEGMENT') {
      const target = { id: t.id, expectedVersion: t.expectedVersion };
      if (body.action === 'remove') await removeSegment(ctx, target);
      else if (body.action === 'now') await segmentNow(ctx, target);
      else if (body.action === 'complete') await completeSegment(ctx, target, !!body.finish);
      else
        throw Problems.validation([
          { path: 'action', message: 'Use “part” ou “event” para agendar.' },
        ]);
      return { ok: true };
    }
    const target = { kind: t.kind, id: t.id, expectedVersion: t.expectedVersion };
    if (body.action === 'add') await schedule(ctx, target, body.sessionId);
    else if (body.action === 'remove') await unschedule(ctx, target);
    else if (body.action === 'now') await nowPlaying(ctx, target);
    else await complete(ctx, target);
    return { ok: true };
  },
);
