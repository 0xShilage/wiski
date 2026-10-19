/**
 * Passkeys as the admin second factor (11 §9, O6; 12 §2 step 4 "done when"):
 * no passkey → 401 with an enrol/verify hint; enrol needs a fresh Google login; a verified
 * assertion opens admin APIs for 10 minutes; replayed assertions, wrong origin / RP ID, missing
 * user verification and counter regressions are rejected.
 */
import { describe, expect, it } from 'vitest';
import * as adminSession from '@/app/api/v1/admin/session/route';
import * as authOptions from '@/app/api/v1/me/passkeys/authentication/options/route';
import * as authVerify from '@/app/api/v1/me/passkeys/authentication/route';
import * as passkeyById from '@/app/api/v1/me/passkeys/[id]/route';
import * as passkeys from '@/app/api/v1/me/passkeys/route';
import * as regOptions from '@/app/api/v1/me/passkeys/registration/options/route';
import * as regVerify from '@/app/api/v1/me/passkeys/registration/route';
import * as items from '@/app/api/v1/admin/catalog/items/route';
import { db } from '@/server/db';
import { makeUser } from '../support/db';
import { ORIGIN, call, req, signedIn } from '../support/http';
import { SoftAuthenticator } from '../support/webauthn';

type Auth = Awaited<ReturnType<typeof signedIn>>;
const as = (a: Auth) => ({ cookies: a.cookies, headers: a.headers });

async function enrol(
  a: Auth,
  authn: SoftAuthenticator,
  over: Parameters<SoftAuthenticator['register']>[1] = {},
) {
  const opt = await call(
    regOptions.POST,
    req('POST', '/api/v1/me/passkeys/registration/options', as(a)),
  );
  expect(opt.status).toBe(200);
  const { options } = (await opt.json()) as { options: { challenge: string } };
  return call(
    regVerify.POST,
    req('POST', '/api/v1/me/passkeys/registration', {
      ...as(a),
      body: { response: authn.register(options, over), label: 'Notebook' },
    }),
  );
}

async function verify(
  a: Auth,
  authn: SoftAuthenticator,
  over: Parameters<SoftAuthenticator['assert']>[1] = {},
) {
  const opt = await call(
    authOptions.POST,
    req('POST', '/api/v1/me/passkeys/authentication/options', as(a)),
  );
  expect(opt.status).toBe(200);
  const { options } = (await opt.json()) as { options: { challenge: string } };
  const response = authn.assert(options, over);
  const res = await call(
    authVerify.POST,
    req('POST', '/api/v1/me/passkeys/authentication', { ...as(a), body: { response } }),
  );
  return { res, response };
}

const adminList = (a: Auth) =>
  call(items.GET, req('GET', '/api/v1/admin/catalog/items?kind=MOVIE', as(a)));

describe('admin second factor', () => {
  it('without a passkey, admin APIs answer 401 PASSKEY_ENROLL_REQUIRED with the enrol URL', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    const a = await signedIn(mod, new Date(), { mfaAt: null });
    const res = await adminList(a);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      code: 'PASSKEY_ENROLL_REQUIRED',
      enrollUrl: '/perfil/seguranca',
    });
    // The probe itself is reachable and reports the state.
    const probe = await call(adminSession.GET, req('GET', '/api/v1/admin/session', as(a)));
    expect(await probe.json()).toMatchObject({ passkey: { enrolled: false, verified: false } });
  });

  it('enrolling needs a fresh Google login (step-up)', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    const a = await signedIn(mod, new Date(Date.now() - 20 * 60_000), { mfaAt: null });
    const res = await call(
      regOptions.POST,
      req('POST', '/api/v1/me/passkeys/registration/options', as(a)),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });

  it('enrol → verify → admin APIs open; after 10 minutes PASSKEY_REQUIRED again', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    const a = await signedIn(mod, new Date(), { mfaAt: null });
    const authn = new SoftAuthenticator(ORIGIN);
    expect((await enrol(a, authn)).status).toBe(201);

    const before = await adminList(a);
    expect(before.status).toBe(401);
    expect(await before.json()).toMatchObject({
      code: 'PASSKEY_REQUIRED',
      verifyUrl: '/api/v1/me/passkeys/authentication/options',
    });

    const { res } = await verify(a, authn);
    expect(res.status).toBe(200);
    expect((await adminList(a)).status).toBe(200);

    const list = await call(passkeys.GET, req('GET', '/api/v1/me/passkeys', as(a)));
    const body = (await list.json()) as { verified: boolean; items: { label: string }[] };
    expect(body.verified).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.label).toBe('Notebook');
    expect(JSON.stringify(body)).not.toMatch(/publicKey|credentialId/);

    await db().session.update({
      where: { id: a.session.id },
      data: { mfaAt: new Date(Date.now() - 11 * 60_000) },
    });
    expect(await (await adminList(a)).json()).toMatchObject({ code: 'PASSKEY_REQUIRED' });

    const audit = await db().auditLog.findMany({
      where: { actorId: mod.id, action: { startsWith: 'passkey.' } },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((r) => r.action)).toEqual(['passkey.register', 'passkey.verify']);
  });

  it('rejects a replayed assertion (challenges are single-use)', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    const a = await signedIn(mod, new Date(), { mfaAt: null });
    const authn = new SoftAuthenticator(ORIGIN);
    await enrol(a, authn);
    const { res, response } = await verify(a, authn);
    expect(res.status).toBe(200);
    // Same response again: the challenge is gone.
    const replay = await call(
      authVerify.POST,
      req('POST', '/api/v1/me/passkeys/authentication', { ...as(a), body: { response } }),
    );
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ code: 'PASSKEY_CHALLENGE_EXPIRED' });
    // Same response against a NEW challenge: the signed challenge doesn't match.
    await call(authOptions.POST, req('POST', '/api/v1/me/passkeys/authentication/options', as(a)));
    const replay2 = await call(
      authVerify.POST,
      req('POST', '/api/v1/me/passkeys/authentication', { ...as(a), body: { response } }),
    );
    expect(replay2.status).toBe(400);
    expect(await replay2.json()).toMatchObject({ code: 'PASSKEY_FAILED' });
  });

  it('rejects wrong origin, wrong RP ID and missing user verification', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    const a = await signedIn(mod, new Date(), { mfaAt: null });
    const authn = new SoftAuthenticator(ORIGIN);
    // registration with a foreign origin / RP ID / no UV
    expect((await enrol(a, authn, { origin: 'https://wiski.fun.evil.example' })).status).toBe(400);
    expect((await enrol(a, authn, { rpId: 'evil.example' })).status).toBe(400);
    expect((await enrol(a, authn, { userVerified: false })).status).toBe(400);
    expect((await enrol(a, authn)).status).toBe(201);
    for (const over of [
      { origin: 'https://phishing.example' },
      { rpId: 'phishing.example' },
      { userVerified: false },
    ]) {
      const { res } = await verify(a, authn, over);
      expect(res.status, JSON.stringify(over)).toBe(400);
    }
    expect((await adminList(a)).status).toBe(401);
  });

  it('rejects a sign counter that does not increase (cloned authenticator)', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    const a = await signedIn(mod, new Date(), { mfaAt: null });
    const authn = new SoftAuthenticator(ORIGIN);
    await enrol(a, authn);
    expect((await verify(a, authn, { counter: 5 })).res.status).toBe(200);
    expect((await verify(a, authn, { counter: 5 })).res.status).toBe(400);
    expect((await verify(a, authn, { counter: 3 })).res.status).toBe(400);
    expect((await verify(a, authn, { counter: 6 })).res.status).toBe(200);
  });

  it("another user's passkey cannot verify my session; foreign ids are 404 on delete", async () => {
    const alice = await makeUser({ role: 'MODERATOR' });
    const bob = await makeUser({ role: 'MODERATOR' });
    const aa = await signedIn(alice, new Date(), { mfaAt: null });
    const ba = await signedIn(bob, new Date(), { mfaAt: null });
    const aliceKey = new SoftAuthenticator(ORIGIN);
    const bobKey = new SoftAuthenticator(ORIGIN);
    await enrol(aa, aliceKey);
    const bobEnrol = await enrol(ba, bobKey);
    const { id: bobPasskeyId } = (await bobEnrol.json()) as { id: string };
    // Alice asks for a challenge but answers with Bob's authenticator.
    const { res } = await verify(aa, bobKey);
    expect(res.status).toBe(400);
    const del = await call(
      passkeyById.DELETE,
      req('DELETE', `/api/v1/me/passkeys/${bobPasskeyId}`, as(aa)),
      { id: bobPasskeyId },
    );
    expect(del.status).toBe(404);
    expect(await db().passkey.count({ where: { id: bobPasskeyId } })).toBe(1);
  });

  it('viewers (USER) cannot use the passkey endpoints at all', async () => {
    const user = await makeUser();
    const a = await signedIn(user);
    expect((await call(passkeys.GET, req('GET', '/api/v1/me/passkeys', as(a)))).status).toBe(404);
  });
});
