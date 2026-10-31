/**
 * Authenticator app (TOTP) as the admin second factor (changed 2026-10-31): set-up needs a fresh
 * Google login (and the existing factor, if any); the first code enables it and returns 6 single-use
 * recovery codes; a code opens admin APIs for 96 hours; codes can't be replayed; recovery codes
 * work once; guessing is rate-limited; the secret never leaves the server after set-up and is
 * encrypted at rest; turning it off forgets remembered browsers.
 */
import { describe, expect, it } from 'vitest';
import * as adminSession from '@/app/api/v1/admin/session/route';
import * as items from '@/app/api/v1/admin/catalog/items/route';
import * as totpRoot from '@/app/api/v1/me/totp/route';
import * as enable from '@/app/api/v1/me/totp/enable/route';
import * as recovery from '@/app/api/v1/me/totp/recovery-codes/route';
import * as setup from '@/app/api/v1/me/totp/setup/route';
import * as verify from '@/app/api/v1/me/totp/verify/route';
import * as regOptions from '@/app/api/v1/me/passkeys/registration/options/route';
import { COOKIE } from '@/server/auth/cookies';
import { MFA_MAX_AGE_SEC, rememberedMfaAt } from '@/server/auth/mfa';
import { base32Decode, hotp, stepAt, totpAt } from '@/server/auth/totp';
import { db } from '@/server/db';
import { makeUser } from '../support/db';
import { call, req, setCookies, signedIn } from '../support/http';

type Auth = Awaited<ReturnType<typeof signedIn>>;
const as = (a: Auth, ip?: string) => ({
  cookies: a.cookies,
  headers: a.headers,
  ...(ip ? { ip } : {}),
});
const json = async <T>(r: Response) => (await r.json()) as T;
const adminList = (a: Auth) =>
  call(items.GET, req('GET', '/api/v1/admin/catalog/items?kind=MOVIE', as(a)));

/** A moderator signed in just now with Google (step-up fresh), no second factor yet. */
async function freshMod(role: 'MODERATOR' | 'STREAMER' = 'MODERATOR') {
  const user = await makeUser({ role });
  const a = await signedIn(user, new Date(), { mfaAt: null });
  return { user, a };
}

async function startSetup(a: Auth) {
  const r = await call(setup.POST, req('POST', '/api/v1/me/totp/setup', as(a)));
  expect(r.status).toBe(200);
  const body = await json<{ secret: string; uri: string; qr: { size: number; path: string } }>(r);
  return { ...body, key: base32Decode(body.secret) };
}

async function enabled(role: 'MODERATOR' | 'STREAMER' = 'MODERATOR') {
  const m = await freshMod(role);
  const s = await startSetup(m.a);
  const r = await call(
    enable.POST,
    req('POST', '/api/v1/me/totp/enable', {
      ...as(m.a),
      body: { code: totpAt(s.key, new Date()) },
    }),
  );
  expect(r.status).toBe(201);
  const body = await json<{ recoveryCodes: string[]; verifiedUntil: string }>(r);
  return { ...m, key: s.key, codes: body.recoveryCodes, res: r };
}

const verifyWith = (a: Auth, body: unknown, ip?: string) =>
  call(verify.POST, req('POST', '/api/v1/me/totp/verify', { ...as(a, ip), body }));

describe('authenticator app: set-up', () => {
  it('needs a recent Google login; returns a QR code and an otpauth URI for this account', async () => {
    const user = await makeUser({ role: 'MODERATOR' });
    const stale = await signedIn(user, new Date(Date.now() - 20 * 60_000), { mfaAt: null });
    const r = await call(setup.POST, req('POST', '/api/v1/me/totp/setup', as(stale)));
    expect(r.status).toBe(401);
    expect((await json<{ code: string }>(r)).code).toBe('STEP_UP_REQUIRED');

    const a = await signedIn(user, new Date(), { mfaAt: null });
    const s = await startSetup(a);
    expect(s.uri).toMatch(
      /^otpauth:\/\/totp\/Wiski%3A%40[a-z0-9_]+\?secret=[A-Z2-7]{32}&issuer=Wiski&algorithm=SHA1&digits=6&period=30$/,
    );
    expect(s.key).toHaveLength(20);
    expect(s.qr.path.length).toBeGreaterThan(100);
    // nothing is stored on the account until the first code proves the app has the secret
    const row = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpEnabledAt).toBeNull();
    expect(row.totpSecretEnc).toBeNull();
  });

  it('viewers get 404; a wrong first code is refused and nothing is enabled', async () => {
    const viewer = await makeUser();
    const va = await signedIn(viewer);
    expect((await call(setup.POST, req('POST', '/x', as(va)))).status).toBe(404);

    const { user, a } = await freshMod();
    const s = await startSetup(a);
    const wrong = String((Number(totpAt(s.key, new Date())) + 1) % 1_000_000).padStart(6, '0');
    const r = await call(
      enable.POST,
      req('POST', '/api/v1/me/totp/enable', { ...as(a), body: { code: wrong } }),
    );
    expect(r.status).toBe(400);
    expect((await json<{ code: string }>(r)).code).toBe('TOTP_INVALID');
    expect(
      (await db().user.findUniqueOrThrow({ where: { id: user.id } })).totpEnabledAt,
    ).toBeNull();
  });

  it('the first code enables it: 6 recovery codes once, this session verified, browser remembered', async () => {
    const { user, codes, res, a } = await enabled();
    expect(codes).toHaveLength(6);
    expect(new Set(codes).size).toBe(6);
    for (const c of codes) expect(c).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
    expect(res.headers.get('cache-control')).toContain('no-store');

    const row = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpEnabledAt).not.toBeNull();
    // encrypted at rest: 12-byte IV + 20-byte ciphertext + 16-byte tag, never the raw secret
    expect(row.totpSecretEnc).toHaveLength(48);
    const stored = await db().mfaRecoveryCode.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(6);
    for (const r of stored) {
      expect(r.codeHash).toHaveLength(32);
      expect(JSON.stringify(r)).not.toContain(codes[0]!.replace('-', ''));
    }

    expect((await adminList(a)).status).toBe(200);
    const device = setCookies(res)[COOKIE.mfa]!;
    expect(device.attributes).toMatchObject({ httponly: true, secure: true, path: '/' });
    expect(String(device.attributes.samesite).toLowerCase()).toBe('lax');
    expect(Number(device.attributes['max-age'])).toBeGreaterThan(MFA_MAX_AGE_SEC - 60);
    expect(Number(device.attributes['max-age'])).toBeLessThanOrEqual(MFA_MAX_AGE_SEC);

    const audit = await db().auditLog.findMany({
      where: { actorId: user.id, action: 'totp.enable' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toEqual({});
  });

  it('a second set-up is refused; adding a factor to a protected account needs that factor first', async () => {
    const { user } = await enabled();
    // new session: Google step-up fresh, but the second factor not checked
    const b = await signedIn(user, new Date(), { mfaAt: null });
    const again = await call(setup.POST, req('POST', '/x', as(b)));
    expect(again.status).toBe(409);
    // …and a passkey can't be added either until the authenticator code is given
    const pk = await call(regOptions.POST, req('POST', '/x', as(b)));
    expect(pk.status).toBe(401);
    expect((await json<{ code: string }>(pk)).code).toBe('MFA_REQUIRED');
  });

  it('the pending secret is bound to the session that started the set-up', async () => {
    const { user, a } = await freshMod();
    const s = await startSetup(a);
    const other = await signedIn(user, new Date(), { mfaAt: null });
    const r = await call(
      enable.POST,
      req('POST', '/x', { ...as(other), body: { code: totpAt(s.key, new Date()) } }),
    );
    expect(r.status).toBe(400);
    expect((await json<{ code: string }>(r)).code).toBe('TOTP_SETUP_EXPIRED');
  });
});

describe('authenticator app: the check', () => {
  it('admin APIs answer MFA_REQUIRED until a code is given, then open for 96 hours', async () => {
    const { user, key } = await enabled();
    const b = await signedIn(user, new Date(), { mfaAt: null });
    const before = await adminList(b);
    expect(before.status).toBe(401);
    expect(await before.json()).toMatchObject({
      code: 'MFA_REQUIRED',
      verifyUrl: '/perfil/seguranca',
    });
    const probe = await call(adminSession.GET, req('GET', '/x', as(b)));
    expect(await probe.json()).toMatchObject({
      mfa: { enrolled: true, totp: true, passkeys: 0, verified: false },
    });

    // the enabling code's time step is used up → the next step's code (within the ±30 s window)
    const next = hotp(key, stepAt(new Date()) + 1n);
    const r = await verifyWith(b, { code: next });
    expect(r.status).toBe(200);
    const body = await json<{ verifiedUntil: string; method: string; recoveryLeft: number }>(r);
    expect(body.method).toBe('totp');
    expect(body.recoveryLeft).toBe(6);
    expect(new Date(body.verifiedUntil).getTime() - Date.now()).toBeGreaterThan(95 * 3600_000);
    expect((await adminList(b)).status).toBe(200);

    // 95 h later still open; 97 h later closed
    await db().session.update({
      where: { id: b.session.id },
      data: { mfaAt: new Date(Date.now() - 95 * 3600_000) },
    });
    expect((await adminList(b)).status).toBe(200);
    await db().session.update({
      where: { id: b.session.id },
      data: { mfaAt: new Date(Date.now() - 97 * 3600_000) },
    });
    expect(await (await adminList(b)).json()).toMatchObject({ code: 'MFA_REQUIRED' });
  });

  it('a code works once (replay, older codes and parallel use refused)', async () => {
    const { user, key } = await enabled();
    const b = await signedIn(user, new Date(), { mfaAt: null });
    const c = await signedIn(user, new Date(), { mfaAt: null });
    const code = hotp(key, stepAt(new Date()) + 1n);
    const [r1, r2] = await Promise.all([verifyWith(b, { code }), verifyWith(c, { code })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    const d = await signedIn(user, new Date(), { mfaAt: null });
    // the current step's code is older than the one already used
    expect((await verifyWith(d, { code: totpAt(key, new Date()) })).status).toBe(400);
    expect((await verifyWith(d, { code })).status).toBe(400);
    expect(await db().auditLog.count({ where: { actorId: user.id, action: 'totp.verify' } })).toBe(
      1,
    );
  });

  it('codes outside ±1 step, malformed codes and extra fields are refused', async () => {
    const { user, key } = await enabled();
    const b = await signedIn(user, new Date(), { mfaAt: null });
    const far = hotp(key, stepAt(new Date()) + 3n);
    expect((await verifyWith(b, { code: far })).status).toBe(400);
    for (const bad of [{ code: '12345' }, { code: 'abcdef' }, { code: '123456', extra: 1 }, {}]) {
      expect((await verifyWith(b, bad)).status).toBe(422);
    }
  });

  it('a recovery code works exactly once and is case/dash-insensitive', async () => {
    const { user, codes } = await enabled();
    const b = await signedIn(user, new Date(), { mfaAt: null });
    const typed = codes[2]!.toLowerCase().replace('-', ' ');
    const r = await verifyWith(b, { recoveryCode: typed });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ method: 'recovery', recoveryLeft: 5 });
    expect((await adminList(b)).status).toBe(200);

    const c = await signedIn(user, new Date(), { mfaAt: null });
    expect((await verifyWith(c, { recoveryCode: codes[2]! })).status).toBe(400);
    expect((await verifyWith(c, { recoveryCode: 'ABCDE-23456' })).status).toBe(400);
    const row = await db().mfaRecoveryCode.count({
      where: { userId: user.id, usedAt: { not: null } },
    });
    expect(row).toBe(1);
    const audit = await db().auditLog.findMany({
      where: { actorId: user.id, action: 'totp.verify' },
    });
    expect(audit.map((x) => x.metadata)).toEqual([{ method: 'recovery' }]);
  });

  it('someone else’s recovery code never works on my account', async () => {
    const alice = await enabled();
    const bob = await enabled();
    const b = await signedIn(bob.user, new Date(), { mfaAt: null });
    expect((await verifyWith(b, { recoveryCode: alice.codes[0]! })).status).toBe(400);
  });

  it('guessing is capped at 6 tries per 15 minutes per account, whatever the IP', async () => {
    const { user, key } = await enabled();
    const b = await signedIn(user, new Date(), { mfaAt: null });
    const wrong = String((Number(totpAt(key, new Date())) + 500_000) % 1_000_000).padStart(6, '0');
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await verifyWith(b, { code: wrong })).status);
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(-2)).toEqual([429, 429]);
    // even the right code is refused while the limit holds
    expect((await verifyWith(b, { code: hotp(key, stepAt(new Date()) + 1n) })).status).toBe(429);
  });
});

describe('authenticator app: managing it', () => {
  it('new recovery codes need a fresh check and a fresh Google login; old ones stop working', async () => {
    const { user, a, codes } = await enabled();
    const r = await call(recovery.POST, req('POST', '/x', as(a)));
    expect(r.status).toBe(201);
    const fresh = (await json<{ recoveryCodes: string[] }>(r)).recoveryCodes;
    expect(fresh).toHaveLength(6);
    expect(fresh).not.toContain(codes[0]);
    const b = await signedIn(user, new Date(), { mfaAt: null });
    expect((await verifyWith(b, { recoveryCode: codes[0]! })).status).toBe(400);
    expect((await verifyWith(b, { recoveryCode: fresh[0]! })).status).toBe(200);

    const unverified = await signedIn(user, new Date(), { mfaAt: null });
    expect((await call(recovery.POST, req('POST', '/x', as(unverified)))).status).toBe(401);
    const staleLogin = await signedIn(user, new Date(Date.now() - 20 * 60_000));
    const sr = await call(recovery.POST, req('POST', '/x', as(staleLogin)));
    expect((await json<{ code: string }>(sr)).code).toBe('STEP_UP_REQUIRED');
  });

  it('turning it off: secret and codes gone, sessions and remembered browsers no longer count', async () => {
    const { user, a } = await enabled();
    const before = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    const r = await call(totpRoot.DELETE, req('DELETE', '/x', as(a)));
    expect(r.status).toBe(204);
    const after = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.totpSecretEnc).toBeNull();
    expect(after.totpEnabledAt).toBeNull();
    expect(after.mfaEpoch).toBe(before.mfaEpoch + 1);
    expect(await db().mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    // no passkey left → the panel asks to set up a second factor again
    const res = await adminList(a);
    expect(await res.json()).toMatchObject({ code: 'MFA_ENROLL_REQUIRED' });
    expect(await db().auditLog.count({ where: { actorId: user.id, action: 'totp.disable' } })).toBe(
      1,
    );
  });
});

describe('remembered browser (96 h across logins)', () => {
  it('only for the same user, the same epoch, within 96 h, while a factor exists', async () => {
    const { user, res } = await enabled();
    const cookie = setCookies(res)[COOKIE.mfa]!.value;
    const fresh = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    const at = await rememberedMfaAt(cookie, fresh);
    expect(at).not.toBeNull();

    const other = await makeUser({ role: 'MODERATOR' });
    expect(await rememberedMfaAt(cookie, other)).toBeNull();
    expect(await rememberedMfaAt(cookie, { ...fresh, mfaEpoch: fresh.mfaEpoch + 1 })).toBeNull();
    expect(await rememberedMfaAt(cookie, { ...fresh, role: 'USER' })).toBeNull();
    expect(await rememberedMfaAt(cookie, fresh, new Date(Date.now() + 97 * 3600_000))).toBeNull();
    expect(await rememberedMfaAt(`${cookie.slice(0, -2)}xx`, fresh)).toBeNull();
    expect(await rememberedMfaAt(undefined, fresh)).toBeNull();
  });
});
