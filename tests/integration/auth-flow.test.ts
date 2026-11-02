/**
 * Google sign-in end to end against a mocked issuer/JWKS (10 §2 step 10): happy path, bad
 * state, bad nonce, replayed code, unverified e-mail, open-redirect attempts, session fixation,
 * ID-token defects (issuer, audience, expiry, signature), step-up (max_age), cookie flags.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as callback } from '@/app/api/auth/google/callback/route';
import { GET as start } from '@/app/api/auth/google/start/route';
import { NextResponse } from 'next/server';
import { COOKIE } from '@/server/auth/cookies';
import { rememberDevice } from '@/server/auth/mfa';
import { resetOidcConfig } from '@/server/auth/oidc';
import { loadSession } from '@/server/auth/session';
import { isStepUpFresh } from '@/server/auth/step-up';
import { db } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { call, ORIGIN, req, setCookies, signedIn } from '../support/http';
import { makeUser } from '../support/db';
import { type CodeSpec, type MockGoogle, startMockGoogle } from '../support/mock-google';

let google: MockGoogle;

beforeAll(async () => {
  google = await startMockGoogle();
  process.env.GOOGLE_ISSUER = google.issuer;
  process.env.GOOGLE_CLIENT_ID = google.clientId;
  process.env.GOOGLE_CLIENT_SECRET = google.clientSecret;
  resetEnvCache();
  resetOidcConfig();
});
afterAll(() => google.close());

/** Step 1: /start → the URL we'd send the browser to + the sealed one-time cookie. */
async function begin(query = '') {
  const res = await call(start, req('GET', `/api/auth/google/start${query}`));
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('location')!);
  const cookie = setCookies(res)[COOKIE.oauth]!;
  return { res, location, params: location.searchParams, cookie };
}

/** Step 2+3: the provider issues a code for these claims; the browser hits /callback. */
async function finish(
  flow: Awaited<ReturnType<typeof begin>>,
  claims: Partial<CodeSpec> = {},
  opts: { cookies?: Record<string, string>; state?: string; withOAuthCookie?: boolean } = {},
) {
  const sub = claims.sub ?? `g-${crypto.randomUUID()}`;
  const code = google.issueCode({
    sub,
    email: claims.email ?? `${sub}@gmail.com`,
    nonce: flow.params.get('nonce')!,
    codeChallenge: flow.params.get('code_challenge')!,
    redirectUri: flow.params.get('redirect_uri')!,
    ...claims,
  });
  const qs = new URLSearchParams({
    code,
    state: opts.state ?? flow.params.get('state')!,
    scope: 'openid email profile',
  });
  const cookies = {
    ...(opts.withOAuthCookie === false ? {} : { [COOKIE.oauth]: flow.cookie.value }),
    ...opts.cookies,
  };
  const res = await call(callback, req('GET', `/api/auth/google/callback?${qs}`, { cookies }));
  return { res, sub, code, qs };
}

const location = (res: Response) => new URL(res.headers.get('location')!, ORIGIN);

describe('/api/auth/google/start', () => {
  it('redirects to the provider with PKCE S256, 256-bit state and nonce', async () => {
    const { location: url, params } = await begin('?returnTo=/conta/sessoes');
    expect(url.origin + url.pathname).toBe(`${google.issuer}/o/oauth2/v2/auth`);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(params.get('state')!.length).toBeGreaterThanOrEqual(43);
    expect(params.get('nonce')!.length).toBeGreaterThanOrEqual(43);
    expect(params.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(params.has('max_age')).toBe(false);
    // returnTo never travels through the provider
    expect(url.toString()).not.toContain('conta');
  });

  it('sets the OAuth cookie as __Host-, HttpOnly, Secure, SameSite=Lax, Path=/, 10 min', async () => {
    const { cookie } = await begin();
    expect(cookie.attributes).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'lax',
      path: '/',
      'max-age': '600',
    });
    expect(cookie.attributes.domain).toBeUndefined();
    expect(cookie.value).toMatch(/^v1\.[\da-f]{8}\.[\w-]+$/); // sealed, not readable
  });

  it('step-up asks Google only for what it supports: the account chooser and auth_time', async () => {
    // Google ignores prompt=login and max_age (no reauth request); requesting them made the
    // OIDC library demand an auth_time Google does not send, so every step-up login failed.
    const { params } = await begin('?stepUp=1&returnTo=/admin');
    expect(params.get('prompt')).toBe('select_account');
    expect(params.get('max_age')).toBeNull();
    expect(JSON.parse(params.get('claims')!)).toEqual({
      id_token: { auth_time: { essential: true } },
    });
  });

  it('rejects unknown query parameters', async () => {
    const res = await call(
      start,
      req('GET', '/api/auth/google/start?redirect=https://evil.example'),
    );
    expect(res.status).toBe(422);
  });
});

describe('/api/auth/google/callback', () => {
  it('happy path: new user → session cookie, onboarding redirect, OAuth cookie cleared', async () => {
    const flow = await begin('?returnTo=/conta/sessoes');
    const { res, sub } = await finish(flow, { email: 'Viewer@Gmail.com' });
    expect(res.status).toBe(303);
    expect(location(res).pathname).toBe('/bem-vindo');
    expect(location(res).searchParams.get('next')).toBe('/conta/sessoes');

    const cookies = setCookies(res);
    expect(cookies[COOKIE.oauth]!.attributes['max-age']).toBe('0');
    const session = cookies[COOKIE.session]!;
    expect(session.attributes).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'lax',
      path: '/',
    });
    expect(session.attributes.domain).toBeUndefined();

    const ctx = await loadSession(session.value);
    expect(ctx?.user.googleSub).toBe(sub);
    expect(ctx?.user.email).toBe('viewer@gmail.com');
    expect(ctx?.session.uaFamily).toBe('Chrome · Windows');
  });

  it('returning user with a username goes straight to returnTo', async () => {
    const user = await makeUser();
    const flow = await begin('?returnTo=/u/fulano');
    const { res } = await finish(flow, { sub: user.googleSub });
    expect(location(res).pathname).toBe('/u/fulano');
  });

  it('identity is the Google `sub`, never the e-mail (no account linking by e-mail)', async () => {
    const victim = await makeUser();
    const flow = await begin();
    const { res, sub } = await finish(flow, { email: victim.email }); // same e-mail, different sub
    const ctx = await loadSession(setCookies(res)[COOKIE.session]!.value);
    expect(ctx?.user.id).not.toBe(victim.id);
    expect(ctx?.user.googleSub).toBe(sub);
  });

  it('bad state → expired, no session', async () => {
    const flow = await begin();
    const { res } = await finish(flow, {}, { state: 'A'.repeat(43) });
    expect(location(res).pathname).toBe('/perfil');
    expect(location(res).searchParams.get('erro')).toBe('expirado');
    expect(setCookies(res)[COOKIE.session]).toBeUndefined();
  });

  it('missing OAuth cookie (login CSRF / other browser) → expired', async () => {
    const flow = await begin();
    const { res } = await finish(flow, {}, { withOAuthCookie: false });
    expect(location(res).searchParams.get('erro')).toBe('expirado');
  });

  it('tampered OAuth cookie → expired', async () => {
    const flow = await begin();
    const tampered = {
      ...flow,
      cookie: { ...flow.cookie, value: flow.cookie.value.slice(0, -2) + 'AA' },
    };
    const { res } = await finish(tampered);
    expect(location(res).searchParams.get('erro')).toBe('expirado');
  });

  it('bad nonce in the ID token → rejected', async () => {
    const flow = await begin();
    const { res } = await finish(flow, { nonce: 'n'.repeat(43) });
    expect(location(res).searchParams.get('erro')).toBe('falha');
  });

  it('ID token without nonce → rejected', async () => {
    const flow = await begin();
    const { res } = await finish(flow, { omitNonce: true });
    expect(location(res).searchParams.get('erro')).toBe('falha');
  });

  it('replayed authorization code → rejected (one-time cookie and one-time code)', async () => {
    const flow = await begin();
    const first = await finish(flow);
    expect(first.res.status).toBe(303);
    expect(location(first.res).pathname).toBe('/bem-vindo');
    // Same callback URL again with the same (already consumed) cookie value.
    const again = await call(
      callback,
      req('GET', `/api/auth/google/callback?${first.qs}`, {
        cookies: { [COOKIE.oauth]: flow.cookie.value },
      }),
    );
    expect(location(again).pathname).toBe('/perfil');
    expect(setCookies(again)[COOKIE.session]).toBeUndefined();
  });

  it('unverified e-mail → refused', async () => {
    for (const emailVerified of [false, 'true']) {
      const flow = await begin();
      const { res, sub } = await finish(flow, { emailVerified });
      expect(location(res).searchParams.get('erro')).toBe('email');
      expect(await db().user.findUnique({ where: { googleSub: sub } })).toBeNull();
    }
  });

  it.each([
    ['wrong issuer', { issuer: 'https://accounts.google.com.evil.example' }],
    ['wrong audience', { audience: 'someone-else.apps.googleusercontent.com' }],
    ['expired token', { expiresInSec: -600, iatOffsetSec: -4000 }],
    ['issued in the future', { iatOffsetSec: 3600 }],
    ['signed with an unknown key', { signWithOtherKey: true }],
  ] as const)('%s → rejected', async (_name, defect) => {
    const flow = await begin();
    const { res } = await finish(flow, defect);
    expect(location(res).searchParams.get('erro')).toBe('falha');
    expect(setCookies(res)[COOKIE.session]).toBeUndefined();
  });

  it('PKCE: a code exchanged without the right verifier fails', async () => {
    const flow = await begin();
    const { res } = await finish(flow, { codeChallenge: 'x'.repeat(43) });
    expect(location(res).searchParams.get('erro')).toBe('falha');
  });

  it('provider error (user cancelled) → cancelado', async () => {
    const flow = await begin();
    const qs = new URLSearchParams({ error: 'access_denied', state: flow.params.get('state')! });
    const res = await call(
      callback,
      req('GET', `/api/auth/google/callback?${qs}`, {
        cookies: { [COOKIE.oauth]: flow.cookie.value },
      }),
    );
    expect(location(res).searchParams.get('erro')).toBe('cancelado');
  });

  it.each([
    'https://evil.example/',
    '//evil.example/x',
    '/\\evil.example',
    '/%2F%2Fevil.example',
    ['javascript', 'alert(1)'].join(':'),
    '/api/auth/logout',
    ' /conta',
    '/conta\nSet-Cookie: x=1',
  ])('open redirect attempt %j lands on a same-origin path', async (attempt) => {
    const user = await makeUser();
    const flow = await begin(`?returnTo=${encodeURIComponent(attempt)}`);
    const { res } = await finish(flow, { sub: user.googleSub });
    const dest = location(res);
    expect(dest.origin).toBe(ORIGIN);
    expect(dest.pathname.startsWith('//')).toBe(false);
    expect(dest.pathname.startsWith('/api/')).toBe(false);
    expect(dest.pathname).not.toContain('evil');
  });

  it('session fixation: a pre-existing session is revoked and a NEW token issued', async () => {
    const user = await makeUser();
    const planted = await signedIn(user); // e.g. a token an attacker planted
    const flow = await begin();
    const { res } = await finish(flow, { sub: user.googleSub }, { cookies: planted.cookies });
    const fresh = setCookies(res)[COOKIE.session]!.value;
    expect(fresh).not.toBe(planted.token);
    expect(await loadSession(planted.token)).toBeNull();
    expect((await loadSession(fresh))?.user.id).toBe(user.id);
  });

  it('a browser that passed the second factor in the last 96 h starts the next login verified', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    // 2FA set up on this account (the device cookie only counts while a factor exists)
    await db().user.update({
      where: { id: mod.id },
      data: { totpSecretEnc: new Uint8Array(48), totpEnabledAt: new Date() },
    });
    const a = await signedIn(mod, new Date(), { mfaAt: null });
    const checkedAt = new Date(Date.now() - 50 * 3600_000);
    const res0 = NextResponse.json({});
    rememberDevice(res0, await db().user.findUniqueOrThrow({ where: { id: mod.id } }), checkedAt);
    const device = setCookies(res0)[COOKIE.mfa]!.value;

    const { res } = await finish(
      await begin(),
      { sub: mod.googleSub },
      {
        cookies: { ...a.cookies, [COOKIE.mfa]: device },
      },
    );
    const ctx = await loadSession(setCookies(res)[COOKIE.session]!.value);
    expect(ctx!.session.mfaAt?.getTime()).toBe(checkedAt.getTime());
    expect(
      await db().auditLog.count({ where: { actorId: mod.id, action: 'mfa.remembered' } }),
    ).toBe(1);

    // without the cookie (another browser), or after the epoch moved: not verified
    const other = await finish(await begin(), { sub: mod.googleSub });
    expect(
      (await loadSession(setCookies(other.res)[COOKIE.session]!.value))!.session.mfaAt,
    ).toBeNull();
    await db().user.update({ where: { id: mod.id }, data: { mfaEpoch: { increment: 1 } } });
    const bumped = await finish(
      await begin(),
      { sub: mod.googleSub },
      {
        cookies: { [COOKIE.mfa]: device },
      },
    );
    expect(
      (await loadSession(setCookies(bumped.res)[COOKIE.session]!.value))!.session.mfaAt,
    ).toBeNull();
  });

  it('records auth_time for step-up and audits privileged logins only', async () => {
    const streamer = await makeUser({ role: 'STREAMER' });
    const viewer = await makeUser();
    const authTime = Math.floor(Date.now() / 1000) - 30;

    const flow = await begin('?stepUp=1');
    const { res } = await finish(flow, { sub: streamer.googleSub, authTime });
    const ctx = await loadSession(setCookies(res)[COOKIE.session]!.value);
    expect(Math.floor(ctx!.session.authTime.getTime() / 1000)).toBe(authTime);
    const rows = await db().auditLog.findMany({
      where: { action: 'auth.login', actorId: streamer.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toEqual({ method: 'google', stepUp: true });

    await finish(await begin(), { sub: viewer.googleSub });
    expect(await db().auditLog.count({ where: { action: 'auth.login', actorId: viewer.id } })).toBe(
      0,
    );
  });

  it('step-up login works without auth_time (Google default); the new session counts as fresh', async () => {
    const viewer = await makeUser();
    const flow = await begin('?stepUp=1&returnTo=/perfil');
    const { res } = await finish(flow, { sub: viewer.googleSub, omitAuthTime: true });
    expect(res.status).toBe(303);
    expect(location(res).pathname).toBe('/perfil');
    const token = setCookies(res)[COOKIE.session]!.value;
    const ctx = await loadSession(token);
    expect(isStepUpFresh(ctx!.session)).toBe(true);
  });

  it('a step-up login whose Google auth_time is old signs in but is not a fresh step-up', async () => {
    const viewer = await makeUser();
    const flow = await begin('?stepUp=1');
    const { res } = await finish(flow, {
      sub: viewer.googleSub,
      authTime: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(res.status).toBe(303);
    const ctx = await loadSession(setCookies(res)[COOKIE.session]!.value);
    expect(isStepUpFresh(ctx!.session)).toBe(false);
  });

  it('deleted accounts cannot sign in', async () => {
    const user = await makeUser({ status: 'DELETED' });
    const { res } = await finish(await begin(), { sub: user.googleSub });
    expect(location(res).searchParams.get('erro')).toBe('conta');
    expect(setCookies(res)[COOKIE.session]).toBeUndefined();
  });
});

describe('login unavailable', () => {
  it('without Google credentials, /start sends the user back with a clear message', async () => {
    const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    resetEnvCache();
    resetOidcConfig();
    try {
      const res = await call(start, req('GET', '/api/auth/google/start'));
      expect(location(res).searchParams.get('erro')).toBe('indisponivel');
    } finally {
      process.env.GOOGLE_CLIENT_ID = saved.id;
      process.env.GOOGLE_CLIENT_SECRET = saved.secret;
      resetEnvCache();
      resetOidcConfig();
    }
  });
});
