import 'server-only';
import type { Role } from '@/generated/prisma/enums';
import type { Session, User } from '@/generated/prisma/client';
import { db } from '../db';
import { randomToken, sha256Bytes } from '../security/crypto';

/**
 * Server-side sessions (02 §2, 05 §5): 256-bit random token in `__Host-wf_session`, only its
 * SHA-256 in the DB → a DB leak yields no usable cookies; revocation is instant.
 * Idle + absolute expiry per role; a new session (new token) on every login (fixation-proof).
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const SESSION_LIFETIME: Record<Role, { idleMs: number; absoluteMs: number }> = {
  USER: { idleMs: 14 * DAY, absoluteMs: 60 * DAY },
  // Admin sessions (05 §5): idle 8 h / absolute 24 h.
  MODERATOR: { idleMs: 8 * HOUR, absoluteMs: 24 * HOUR },
  SUPER_MODERATOR: { idleMs: 8 * HOUR, absoluteMs: 24 * HOUR },
  STREAMER: { idleMs: 8 * HOUR, absoluteMs: 24 * HOUR },
};

/** lastSeenAt / idle extension is written at most this often (avoids a write per request). */
export const TOUCH_INTERVAL_MS = 5 * 60_000;

const TOKEN_FORMAT = /^[\w-]{43}$/;

export type SessionContext = { session: Session; user: User };

export async function createSession(
  user: Pick<User, 'id' | 'role'>,
  {
    authTime,
    uaFamily,
    mfaAt = null,
  }: { authTime: Date; uaFamily: string | null; mfaAt?: Date | null },
  now = new Date(),
): Promise<{ token: string; session: Session; maxAgeSec: number }> {
  const token = randomToken(32);
  const life = SESSION_LIFETIME[user.role];
  const session = await db().session.create({
    data: {
      tokenHash: sha256Bytes(token),
      userId: user.id,
      authTime,
      mfaAt,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + Math.min(life.idleMs, life.absoluteMs)),
      expiresAt: new Date(now.getTime() + life.absoluteMs),
      uaFamily,
    },
  });
  return { token, session, maxAgeSec: Math.floor(life.absoluteMs / 1000) };
}

/** Resolve a cookie token to a live session, or null. Extends the idle window when due. */
export async function loadSession(
  token: string | undefined | null,
  now = new Date(),
): Promise<SessionContext | null> {
  if (!token || !TOKEN_FORMAT.test(token)) return null;
  const found = await db().session.findUnique({
    where: { tokenHash: sha256Bytes(token) },
    include: { user: true },
  });
  if (!found) return null;
  const { user, ...session } = found;
  const t = now.getTime();
  const life = SESSION_LIFETIME[user.role];
  if (
    session.revokedAt !== null ||
    session.expiresAt.getTime() <= t ||
    session.idleExpiresAt.getTime() <= t ||
    // Role-based absolute cap (a USER session can't outlive the admin cap after a promotion).
    session.createdAt.getTime() + life.absoluteMs <= t ||
    user.status === 'DELETED'
  ) {
    return null;
  }
  // A timed suspension that ran out lifts itself on the next request (Phase 4).
  if (user.status === 'SUSPENDED' && user.suspendedUntil && user.suspendedUntil.getTime() <= t) {
    await db().user.updateMany({
      where: { id: user.id, status: 'SUSPENDED', suspendedUntil: user.suspendedUntil },
      data: { status: 'ACTIVE', suspendedUntil: null },
    });
    user.status = 'ACTIVE';
    user.suspendedUntil = null;
  }
  if (t - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    const idleExpiresAt = new Date(Math.min(t + life.idleMs, session.expiresAt.getTime()));
    // Conditional update: a concurrent revoke wins.
    const updated = await db().session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { lastSeenAt: now, idleExpiresAt },
    });
    if (updated.count === 0) return null;
    session.lastSeenAt = now;
    session.idleExpiresAt = idleExpiresAt;
  }
  return { session, user };
}

/** Revoke one of the user's own sessions. Returns false when it isn't theirs (→ 404). */
export async function revokeOwnSession(
  userId: string,
  sessionId: string,
  now = new Date(),
): Promise<boolean> {
  const res = await db().session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: now },
  });
  return res.count === 1;
}

export async function revokeAllSessions(
  userId: string,
  opts: { exceptSessionId?: string } = {},
  now = new Date(),
): Promise<number> {
  const res = await db().session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(opts.exceptSessionId ? { id: { not: opts.exceptSessionId } } : {}),
    },
    data: { revokedAt: now },
  });
  return res.count;
}

export async function revokeSessionByToken(
  token: string | undefined | null,
  now = new Date(),
): Promise<void> {
  if (!token || !TOKEN_FORMAT.test(token)) return;
  await db().session.updateMany({
    where: { tokenHash: sha256Bytes(token), revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Active sessions for /perfil/sessoes (never exposes token hashes). */
export async function listActiveSessions(userId: string, now = new Date()) {
  return db().session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now }, idleExpiresAt: { gt: now } },
    select: { id: true, createdAt: true, lastSeenAt: true, uaFamily: true, authTime: true },
    orderBy: { lastSeenAt: 'desc' },
    take: 50,
  });
}

/** Coarse device label ("Chrome · Windows"); the raw user-agent is never stored. */
export function uaFamilyFrom(browser: string | undefined, os: string | undefined): string | null {
  const b = browser?.replace(/[^\w .-]/g, '').slice(0, 24);
  const o = os?.replace(/[^\w .-]/g, '').slice(0, 24);
  if (!b && !o) return null;
  return [b ?? 'Navegador', o ?? 'Sistema'].join(' · ');
}
