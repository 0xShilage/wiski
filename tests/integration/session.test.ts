/** Server-side sessions: hashed tokens, idle/absolute expiry, rotation, revocation (05 §5). */
import { describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { sha256 } from '@/server/security/crypto';
import {
  createSession,
  listActiveSessions,
  loadSession,
  revokeAllSessions,
  revokeOwnSession,
  SESSION_LIFETIME,
  TOUCH_INTERVAL_MS,
} from '@/server/auth/session';
import { makeUser } from '../support/db';

const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe('sessions', () => {
  it('stores only the SHA-256 of a 256-bit token', async () => {
    const user = await makeUser();
    const { token, session } = await createSession(user, {
      authTime: new Date(),
      uaFamily: 'Chrome · Windows',
    });
    expect(token).toMatch(/^[\w-]{43}$/);
    const row = await db().session.findUniqueOrThrow({ where: { id: session.id } });
    expect(Buffer.from(row.tokenHash).equals(sha256(token))).toBe(true);
    expect(JSON.stringify(row)).not.toContain(token);
    expect((await loadSession(token))?.user.id).toBe(user.id);
  });

  it('rejects malformed, unknown and revoked tokens', async () => {
    const user = await makeUser();
    const { token, session } = await createSession(user, { authTime: new Date(), uaFamily: null });
    expect(await loadSession('not-a-token')).toBeNull();
    expect(await loadSession('A'.repeat(43))).toBeNull();
    await revokeOwnSession(user.id, session.id);
    expect(await loadSession(token)).toBeNull();
  });

  it('expires after the idle window, and extends it on use (throttled)', async () => {
    const user = await makeUser();
    const t0 = new Date();
    const { token } = await createSession(user, { authTime: t0, uaFamily: null }, t0);
    const life = SESSION_LIFETIME.USER;
    // Used just before the idle deadline → extended.
    const t1 = at(t0, life.idleMs - 1000);
    expect(await loadSession(token, t1)).not.toBeNull();
    const t2 = at(t1, life.idleMs - 1000);
    expect(await loadSession(token, t2)).not.toBeNull();
    // Idle for longer than the window → gone.
    expect(await loadSession(token, at(t2, life.idleMs + 1000))).toBeNull();
  });

  it('does not write lastSeenAt on every request', async () => {
    const user = await makeUser();
    const t0 = new Date();
    const { token, session } = await createSession(user, { authTime: t0, uaFamily: null }, t0);
    await loadSession(token, at(t0, TOUCH_INTERVAL_MS - 1000));
    const row = await db().session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.lastSeenAt.getTime()).toBe(t0.getTime());
  });

  it('enforces the absolute lifetime even when active', async () => {
    const user = await makeUser();
    const t0 = new Date();
    const { token } = await createSession(user, { authTime: t0, uaFamily: null }, t0);
    expect(await loadSession(token, at(t0, SESSION_LIFETIME.USER.absoluteMs + 1))).toBeNull();
  });

  it('caps admin sessions at idle 8 h / absolute 24 h', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    const t0 = new Date();
    const { token, session } = await createSession(mod, { authTime: t0, uaFamily: null }, t0);
    expect(session.expiresAt.getTime() - t0.getTime()).toBe(24 * 3_600_000);
    expect(await loadSession(token, at(t0, 8 * 3_600_000 + 1000))).toBeNull();
  });

  it('applies the stricter cap when a USER session belongs to someone promoted later', async () => {
    const user = await makeUser();
    const t0 = new Date();
    const { token } = await createSession(user, { authTime: t0, uaFamily: null }, t0);
    await db().user.update({ where: { id: user.id }, data: { role: 'STREAMER' } });
    expect(await loadSession(token, at(t0, 7 * 3_600_000))).not.toBeNull();
    expect(await loadSession(token, at(t0, 25 * 3_600_000))).toBeNull();
  });

  it('drops sessions of deleted accounts', async () => {
    const user = await makeUser();
    const { token } = await createSession(user, { authTime: new Date(), uaFamily: null });
    await db().user.update({
      where: { id: user.id },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
    expect(await loadSession(token)).toBeNull();
  });

  it('revokes only own sessions; "others" keeps the current one', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const a1 = await createSession(alice, { authTime: new Date(), uaFamily: 'A1' });
    const a2 = await createSession(alice, { authTime: new Date(), uaFamily: 'A2' });
    const b1 = await createSession(bob, { authTime: new Date(), uaFamily: 'B1' });
    expect(await revokeOwnSession(alice.id, b1.session.id)).toBe(false); // not hers
    expect(await loadSession(b1.token)).not.toBeNull();
    expect(await revokeAllSessions(alice.id, { exceptSessionId: a1.session.id })).toBe(1);
    expect(await loadSession(a1.token)).not.toBeNull();
    expect(await loadSession(a2.token)).toBeNull();
    const listed = await listActiveSessions(alice.id);
    expect(listed.map((s) => s.uaFamily)).toEqual(['A1']);
    expect(Object.keys(listed[0]!)).not.toContain('tokenHash');
  });
});
