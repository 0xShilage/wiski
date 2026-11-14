import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { versionInput } from '@/server/admin/input';
import { announceAfter, announceLiveStart } from '@/server/chat/announce';
import { startSession } from '@/server/live/schedule';

/** POST /api/v1/admin/sessions/[id]/start — PLANNED → LIVE (one live session at a time). */
export const POST = route<'moderator', typeof versionInput, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: versionInput },
  async ({ body, user, requestId, params }) => {
    const session = await startSession(
      { actor: user, requestId },
      uuidParam(params.id),
      body.expectedVersion,
    );
    // "🔴 A live começou! Hoje tem: …" (2026-11-13), after the change, never failing it
    announceAfter(() => announceLiveStart(session.id));
    return { session };
  },
);
