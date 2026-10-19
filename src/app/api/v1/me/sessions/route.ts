import { NextResponse } from 'next/server';
import { listActiveSessions, revokeAllSessions } from '@/server/auth/session';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/me/sessions — my active sessions (no token material). */
export const GET = route(
  { methods: ['GET'], access: 'user', rateLimit: RL.account },
  async ({ user, session }) => ({
    items: (await listActiveSessions(user.id)).map((s) => ({
      id: s.id,
      device: s.uaFamily ?? 'Dispositivo desconhecido',
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.id === session.id,
    })),
  }),
);

/** DELETE /api/v1/me/sessions — "sair de todos os outros dispositivos". */
export const DELETE = route(
  { methods: ['DELETE'], access: 'user', rateLimit: RL.account },
  async ({ user, session, audit }) => {
    const revoked = await revokeAllSessions(user.id, { exceptSessionId: session.id });
    await audit({
      action: 'session.revoke',
      targetType: 'User',
      targetId: user.id,
      metadata: { sessionId: null, scope: 'others' },
    });
    return NextResponse.json({ ok: true, revoked });
  },
);
