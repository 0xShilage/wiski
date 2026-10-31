/** Onboarding, usernames (rules, reserved list, 30-day holds), avatars, my sessions, logout. */
import { describe, expect, it } from 'vitest';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as me } from '@/app/api/v1/me/route';
import { POST as onboarding } from '@/app/api/v1/me/onboarding/route';
import { PATCH as profile } from '@/app/api/v1/me/profile/route';
import { DELETE as revokeOthers, GET as listSessions } from '@/app/api/v1/me/sessions/route';
import { DELETE as revokeOne } from '@/app/api/v1/me/sessions/[id]/route';
import { GET as availability } from '@/app/api/v1/usernames/availability/route';
import { COOKIE } from '@/server/auth/cookies';
import { loadSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { makeUser } from '../support/db';
import { call, req, setCookies, signedIn } from '../support/http';

const uniq = () => `u${Math.random().toString(36).slice(2, 10)}`;

async function newcomer() {
  const user = await makeUser({ username: null });
  return { user, ...(await signedIn(user)) };
}

async function post(
  handler: typeof onboarding,
  s: Awaited<ReturnType<typeof newcomer>>,
  body: unknown,
) {
  return call(handler, req('POST', '/x', { body, cookies: s.cookies, headers: s.headers }));
}

describe('onboarding', () => {
  it('sets username + avatar once, canonicalised to lowercase', async () => {
    const s = await newcomer();
    const name = uniq();
    const res = await post(onboarding, s, {
      username: `  ${name.toUpperCase()} `,
      avatarKey: 'mascote-2-violet',
    });
    expect(res.status).toBe(200);
    const user = await db().user.findUniqueOrThrow({ where: { id: s.user.id } });
    expect(user).toMatchObject({ username: name, avatarKey: 'mascote-2-violet' });
    expect(
      await db().auditLog.count({ where: { action: 'user.onboarding', actorId: s.user.id } }),
    ).toBe(1);

    const again = await post(onboarding, s, { username: uniq(), avatarKey: 'mascote-1-ink' });
    expect(again.status).toBe(409);
  });

  it.each([
    'admin',
    'wiski_oficial',
    'suporte',
    'moderador123',
    'ab',
    'açaí',
    'nome com espaço',
    'x'.repeat(21),
    'conta',
  ])('refuses %j', async (username) => {
    const s = await newcomer();
    const res = await post(onboarding, s, { username, avatarKey: 'mascote-1-ink' });
    expect(res.status).toBe(422);
  });

  it('refuses an unknown avatar key (presets only, no uploads)', async () => {
    const s = await newcomer();
    const res = await post(onboarding, s, { username: uniq(), avatarKey: '../../etc/passwd' });
    expect(res.status).toBe(422);
  });

  it('refuses a taken username (409) — including under a race', async () => {
    const name = uniq();
    const [a, b] = await Promise.all([newcomer(), newcomer()]);
    const results = await Promise.all([
      post(onboarding, a, { username: name, avatarKey: 'mascote-1-ink' }),
      post(onboarding, b, { username: name, avatarKey: 'mascote-1-ink' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('username changes and 30-day holds', () => {
  it('allows one change per 30 days and holds the old name for its owner', async () => {
    const owner = await makeUser({ username: uniq() });
    const old = owner.username!;
    await db().user.update({
      where: { id: owner.id },
      data: { usernameChangedAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    const s = await signedIn(owner);
    const renamed = uniq();
    const res = await call(
      profile,
      req('PATCH', '/x', { body: { username: renamed }, cookies: s.cookies, headers: s.headers }),
    );
    expect(res.status).toBe(200);

    // Cool-down: a second change right away is refused.
    const again = await call(
      profile,
      req('PATCH', '/x', { body: { username: uniq() }, cookies: s.cookies, headers: s.headers }),
    );
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe('USERNAME_COOLDOWN');

    // Nobody else can grab the released name for 30 days (impersonation).
    const hold = await db().usernameHold.findUniqueOrThrow({ where: { username: old } });
    expect(hold.userId).toBe(owner.id);
    expect(hold.holdUntil.getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    const other = await newcomer();
    expect(
      (await post(onboarding, other, { username: old, avatarKey: 'mascote-1-ink' })).status,
    ).toBe(409);
    const avail = await call(availability, req('GET', `/x?u=${old}`, { cookies: other.cookies }));
    expect(await avail.json()).toEqual({ available: false });
    // …but the original owner may take it back.
    const ownAvail = await call(availability, req('GET', `/x?u=${old}`, { cookies: s.cookies }));
    expect(await ownAvail.json()).toEqual({ available: true });
  });

  it('username cool-down: 30 days for viewers, 5 days for moderators and the streamer', async () => {
    const rename = async (role: 'USER' | 'MODERATOR' | 'STREAMER', daysAgo: number) => {
      const u = await makeUser({ username: uniq(), role });
      await db().user.update({
        where: { id: u.id },
        data: { usernameChangedAt: new Date(Date.now() - daysAgo * 86_400_000) },
      });
      const s = await signedIn(u);
      const res = await call(
        profile,
        req('PATCH', '/x', { body: { username: uniq() }, cookies: s.cookies, headers: s.headers }),
      );
      return { status: res.status, body: (await res.json()) as { code?: string; detail?: string } };
    };
    const viewer = await rename('USER', 6);
    expect(viewer.status).toBe(409);
    expect(viewer.body.detail).toContain('30 dias');
    expect((await rename('USER', 31)).status).toBe(200);
    const mod = await rename('MODERATOR', 4);
    expect(mod.status).toBe(409);
    expect(mod.body.detail).toContain('5 dias');
    expect((await rename('MODERATOR', 6)).status).toBe(200);
    expect((await rename('STREAMER', 6)).status).toBe(200);
  });

  it('availability answers {available} only, and false for reserved names', async () => {
    const s = await signedIn(await makeUser());
    for (const [u, expected] of [
      [uniq(), true],
      ['admin', false],
      ['WISKI', false],
    ] as const) {
      const res = await call(availability, req('GET', `/x?u=${u}`, { cookies: s.cookies }));
      expect(await res.json()).toEqual({ available: expected });
    }
  });

  it('changes the avatar (audited)', async () => {
    const user = await makeUser();
    const s = await signedIn(user);
    const res = await call(
      profile,
      req('PATCH', '/x', {
        body: { avatarKey: 'mascote-3-lilac' },
        cookies: s.cookies,
        headers: s.headers,
      }),
    );
    expect(res.status).toBe(200);
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).avatarKey).toBe(
      'mascote-3-lilac',
    );
  });
});

describe('me, sessions, logout', () => {
  it('GET /me exposes no e-mail or Google id', async () => {
    const user = await makeUser();
    const s = await signedIn(user);
    const body = await (await call(me, req('GET', '/x', { cookies: s.cookies }))).json();
    expect(body).toMatchObject({
      id: user.id,
      username: user.username,
      role: 'USER',
      onboarded: true,
      csrfToken: s.headers['x-csrf-token'],
    });
    expect(JSON.stringify(body)).not.toContain(user.email);
    expect(JSON.stringify(body)).not.toContain(user.googleSub);
  });

  it("lists my sessions and revokes one of mine; someone else's → 404", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const a1 = await signedIn(alice);
    const a2 = await signedIn(alice);
    const b1 = await signedIn(bob);

    const list = (await (
      await call(listSessions, req('GET', '/x', { cookies: a1.cookies }))
    ).json()) as { items: { id: string; current: boolean }[] };
    expect(list.items.map((i) => i.id).sort()).toEqual([a1.session.id, a2.session.id].sort());
    expect(list.items.find((i) => i.id === a1.session.id)?.current).toBe(true);

    const idor = await call(
      revokeOne,
      req('DELETE', '/x', { cookies: a1.cookies, headers: a1.headers }),
      { id: b1.session.id },
    );
    expect(idor.status).toBe(404);
    expect(await loadSession(b1.token)).not.toBeNull();
    expect(
      (
        await call(revokeOne, req('DELETE', '/x', { cookies: a1.cookies, headers: a1.headers }), {
          id: 'not-a-uuid',
        })
      ).status,
    ).toBe(404);

    const ok = await call(
      revokeOne,
      req('DELETE', '/x', { cookies: a1.cookies, headers: a1.headers }),
      { id: a2.session.id },
    );
    expect(ok.status).toBe(200);
    expect(await loadSession(a2.token)).toBeNull();
  });

  it('"sair dos outros dispositivos" keeps only the current session', async () => {
    const user = await makeUser();
    const cur = await signedIn(user);
    const other1 = await signedIn(user);
    const other2 = await signedIn(user);
    const res = await call(
      revokeOthers,
      req('DELETE', '/x', { cookies: cur.cookies, headers: cur.headers }),
    );
    expect(await res.json()).toEqual({ ok: true, revoked: 2 });
    expect(await loadSession(cur.token)).not.toBeNull();
    expect(await loadSession(other1.token)).toBeNull();
    expect(await loadSession(other2.token)).toBeNull();
  });

  it('logout revokes the session server-side and clears the cookie', async () => {
    const user = await makeUser();
    const s = await signedIn(user);
    const res = await call(logout, req('POST', '/x', { cookies: s.cookies, headers: s.headers }));
    expect(res.status).toBe(200);
    const cookie = setCookies(res)[COOKIE.session]!;
    expect(cookie.attributes['max-age']).toBe('0');
    expect(cookie.attributes).toMatchObject({ httponly: true, secure: true, path: '/' });
    expect(await loadSession(s.token)).toBeNull();
    // the remembered second factor goes too (shared computers)
    expect(setCookies(res)[COOKIE.mfa]!.attributes['max-age']).toBe('0');
  });

  it('logout is a CSRF-protected POST (a cross-site form cannot log you out)', async () => {
    const user = await makeUser();
    const s = await signedIn(user);
    const res = await call(
      logout,
      req('POST', '/x', {
        cookies: s.cookies,
        headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(res.status).toBe(403);
    expect(await loadSession(s.token)).not.toBeNull();
  });
});
