/**
 * People (Phase 4): suspensions (moderators ≤ 7 days, the streamer longer with step-up), role and
 * VIP changes (streamer + step-up), protections (self, streamer, privileged accounts), expiry, and
 * the LGPD self-service tools (data export, account erasure).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { loadSession } from '@/server/auth/session';
import { GET as usersRoute } from '@/app/api/v1/admin/users/route';
import { POST as suspendRoute } from '@/app/api/v1/admin/users/[id]/suspend/route';
import { POST as unsuspendRoute } from '@/app/api/v1/admin/users/[id]/unsuspend/route';
import { POST as roleRoute } from '@/app/api/v1/admin/users/[id]/role/route';
import { POST as vipRoute } from '@/app/api/v1/admin/users/[id]/vip/route';
import { GET as exportRoute } from '@/app/api/v1/me/export/route';
import { POST as eraseRoute } from '@/app/api/v1/me/erase/route';
import { makeUser } from '../support/db';
import { as, hit, type Who } from '../support/live';
import { like, makeReview, postReview, report, watchedItem } from '../support/reviews';

beforeEach(() => {
  vi.stubGlobal('fetch', async () => Response.json({ success: true })); // Turnstile
});

const suspend = (who: Who, id: string, days: number | null) =>
  hit(suspendRoute, 'POST', '', { who, params: { id }, body: { days } });
const stale = () => as('STREAMER', { authTime: new Date(Date.now() - 60 * 60_000) });

describe('suspensions', () => {
  it('a moderator suspends; the person can still read but not write', async () => {
    const mod = await as('MODERATOR');
    const target = await as('USER');
    const r = await suspend(mod, target.user.id, 7);
    expect((r.json.user as { status: string }).status).toBe('SUSPENDED');
    const item = await watchedItem();
    expect((await postReview(target, item.id)).json.code).toBe('ACCOUNT_SUSPENDED');
    const review = await makeReview(item.id);
    expect((await like(target, review.id)).json.code).toBe('ACCOUNT_SUSPENDED');
    // still signed in: suspended accounts keep read access and their data tools
    expect(await loadSession(target.auth.token)).not.toBeNull();
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'user.suspend', targetId: target.user.id },
    });
    expect(log.metadata).toMatchObject({ days: 7 });

    // longer than 7 days: moderators too (2026-11-08), with a fresh Google confirmation
    const staleMod = await as('MODERATOR', { authTime: new Date(Date.now() - 60 * 60_000) });
    const long = await suspend(staleMod, (await as('USER')).user.id, 8);
    expect([long.res.status, long.json.code]).toEqual([401, 'STEP_UP_REQUIRED']);
    expect((await suspend(mod, (await as('USER')).user.id, 30)).res.status).toBe(200);
  });

  it('suspends longer or indefinitely, with Google step-up; a moderator can lift it', async () => {
    const target = await as('USER');
    const r1 = await suspend(await stale(), target.user.id, null);
    expect([r1.res.status, r1.json.code]).toEqual([401, 'STEP_UP_REQUIRED']);
    const r2 = await suspend(await as('STREAMER'), target.user.id, null);
    expect(r2.json.user).toMatchObject({ status: 'SUSPENDED', suspendedUntil: null });
    const ok = await hit(unsuspendRoute, 'POST', '', {
      who: await as('MODERATOR'),
      params: { id: target.user.id },
    });
    expect((ok.json.user as { status: string }).status).toBe('ACTIVE');
  });

  it('nobody acts on themselves or the streamer; moderators must be demoted first', async () => {
    const mod = await as('MODERATOR');
    expect((await suspend(mod, mod.user.id, 1)).json.code).toBe('NOT_ON_YOURSELF');
    const s = await as('STREAMER');
    expect((await suspend(mod, s.user.id, 1)).json.code).toBe('PROTECTED_ACCOUNT');
    const other = await as('MODERATOR');
    expect((await suspend(s, other.user.id, 1)).json.code).toBe('DEMOTE_FIRST');
    expect((await suspend(mod, '00000000-0000-7000-8000-000000000000', 1)).res.status).toBe(404);
  });

  it('a timed suspension lifts itself when it runs out', async () => {
    const target = await as('USER');
    await suspend(await as('MODERATOR'), target.user.id, 1);
    await db().user.update({
      where: { id: target.user.id },
      data: { suspendedUntil: new Date(Date.now() - 1000) },
    });
    const ctx = await loadSession(target.auth.token);
    expect(ctx?.user.status).toBe('ACTIVE');
    expect(
      (await db().user.findUniqueOrThrow({ where: { id: target.user.id } })).suspendedUntil,
    ).toBeNull();
  });
});

describe('roles and VIP (streamer + step-up)', () => {
  it("USER → MODERATOR ends the person's sessions; audited", async () => {
    const target = await as('USER');
    const r = await hit(roleRoute, 'POST', '', {
      who: await as('STREAMER'),
      params: { id: target.user.id },
      body: { role: 'MODERATOR' },
    });
    expect((r.json.user as { role: string }).role).toBe('MODERATOR');
    expect(await loadSession(target.auth.token)).toBeNull();
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'user.role', targetId: target.user.id },
    });
    expect(log.metadata).toEqual({ from: 'USER', to: 'MODERATOR' });
  });

  it('no STREAMER role through the API; moderators get 404; stale login → step-up', async () => {
    const target = await as('USER');
    expect(
      (
        await hit(roleRoute, 'POST', '', {
          who: await as('STREAMER'),
          params: { id: target.user.id },
          body: { role: 'STREAMER' },
        })
      ).res.status,
    ).toBe(422);
    expect(
      (
        await hit(roleRoute, 'POST', '', {
          who: await as('MODERATOR'),
          params: { id: target.user.id },
          body: { role: 'MODERATOR' },
        })
      ).res.status,
    ).toBe(404);
    expect(
      (
        await hit(roleRoute, 'POST', '', {
          who: await stale(),
          params: { id: target.user.id },
          body: { role: 'MODERATOR' },
        })
      ).json.code,
    ).toBe('STEP_UP_REQUIRED');
  });

  it('Super Moderador: the streamer names one; it has the streamer powers, but not over its peers', async () => {
    const setRole = (who: Who, id: string, role: string) =>
      hit(roleRoute, 'POST', '', { who, params: { id }, body: { role } });
    const streamer = await as('STREAMER');
    const target = await as('MODERATOR');
    const r = await setRole(streamer, target.user.id, 'SUPER_MODERATOR');
    expect((r.json.user as { role: string }).role).toBe('SUPER_MODERATOR');
    expect(await loadSession(target.auth.token)).toBeNull();
    expect(
      (
        await db().auditLog.findFirstOrThrow({
          where: { action: 'user.role', targetId: target.user.id },
        })
      ).metadata,
    ).toEqual({ from: 'MODERATOR', to: 'SUPER_MODERATOR' });

    const sup = await as('SUPER_MODERATOR');
    // the streamer's powers: roles USER ↔ MODERATOR, VIP, long suspensions
    const person = await as('USER');
    expect(
      ((await setRole(sup, person.user.id, 'MODERATOR')).json.user as { role: string }).role,
    ).toBe('MODERATOR');
    expect(((await setRole(sup, person.user.id, 'USER')).json.user as { role: string }).role).toBe(
      'USER',
    );
    const vip = await hit(vipRoute, 'POST', '', {
      who: sup,
      params: { id: person.user.id },
      body: { vip: true },
    });
    expect((vip.json.user as { isVip: boolean }).isVip).toBe(true);
    expect((await suspend(sup, person.user.id, null)).res.status).toBe(200);

    // …but only the streamer names (or removes) a Super Moderador
    const other = await as('MODERATOR');
    const named = await setRole(sup, other.user.id, 'SUPER_MODERATOR');
    expect([named.res.status, named.json.code]).toEqual([403, 'STREAMER_ONLY']);
    // a Super Moderador's account is the streamer's to change, not a peer's
    const peer = await as('SUPER_MODERATOR');
    for (const res of [
      await setRole(sup, peer.user.id, 'USER'),
      await hit(vipRoute, 'POST', '', {
        who: sup,
        params: { id: peer.user.id },
        body: { vip: true },
      }),
    ])
      expect([res.res.status, res.json.code]).toEqual([409, 'PROTECTED_ACCOUNT']);
    expect((await setRole(sup, streamer.user.id, 'USER')).json.code).toBe('PROTECTED_ACCOUNT');
    // the streamer takes it back
    expect(
      ((await setRole(streamer, peer.user.id, 'MODERATOR')).json.user as { role: string }).role,
    ).toBe('MODERATOR');
    // and a moderator never sees the role endpoint
    expect((await setRole(await as('MODERATOR'), person.user.id, 'MODERATOR')).res.status).toBe(
      404,
    );
  });

  it('VIP on/off', async () => {
    const target = await as('USER');
    const s = await as('STREAMER');
    const on = await hit(vipRoute, 'POST', '', {
      who: s,
      params: { id: target.user.id },
      body: { vip: true },
    });
    expect((on.json.user as { isVip: boolean }).isVip).toBe(true);
    expect(
      (await db().user.findUniqueOrThrow({ where: { id: target.user.id } })).vipSince,
    ).not.toBeNull();
    const off = await hit(vipRoute, 'POST', '', {
      who: s,
      params: { id: target.user.id },
      body: { vip: false },
    });
    expect((off.json.user as { isVip: boolean }).isVip).toBe(false);
    expect(
      await db().auditLog.count({ where: { action: 'user.vip', targetId: target.user.id } }),
    ).toBe(2);
  });

  it('the list: search by username prefix, filters, e-mail for staff', async () => {
    const u = await makeUser({ username: `procura_${Date.now().toString(36)}`.slice(0, 20) });
    const byMod = await hit(usersRoute, 'GET', `/api/v1/admin/users?q=${u.username}`, {
      who: await as('MODERATOR'),
    });
    const list = byMod.json.users as { id: string; email: string | null }[];
    expect(list.map((x) => x.id)).toEqual([u.id]);
    expect(list[0]!.email).toBe(u.email);
    const bySt = await hit(usersRoute, 'GET', `/api/v1/admin/users?q=${u.username}`, {
      who: await as('STREAMER'),
    });
    expect((bySt.json.users as { email: string }[])[0]!.email).toBe(u.email);
    const staff = await hit(usersRoute, 'GET', '/api/v1/admin/users?filter=staff', {
      who: await as('MODERATOR'),
    });
    expect((staff.json.users as { role: string }[]).every((x) => x.role !== 'USER')).toBe(true);
  });
});

describe('LGPD self-service', () => {
  it('export: my account, orders, reviews, likes, reports — nothing of anyone else, no secrets', async () => {
    const me = await as('USER');
    const item = await watchedItem();
    await postReview(me, item.id);
    const other = await makeReview(item.id);
    await like(me, other.id);
    await db().user.update({
      where: { id: me.user.id },
      data: { createdAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    await report(me, other.id, { reason: 'SPAM', note: 'nota minha' });
    const r = await hit(exportRoute, 'GET', '/api/v1/me/export', { who: me });
    expect(r.res.headers.get('content-disposition')).toContain('attachment');
    const data = r.json as {
      account: { email: string };
      reviews: unknown[];
      likes: unknown[];
      reports: { note: string }[];
    };
    expect(data.account.email).toBe(me.user.email);
    expect(data.reviews).toHaveLength(1);
    expect(data.likes).toHaveLength(1);
    expect(data.reports[0]!.note).toBe('nota minha');
    const text = JSON.stringify(r.json);
    expect(text).not.toMatch(/tokenHash|accessTokenHash|googleSub|keyHash|publicKey/);
    expect(
      await db().auditLog.count({ where: { action: 'user.export', targetId: me.user.id } }),
    ).toBe(1);
  });

  it('erase: needs a fresh login and the username typed; removes reviews/likes/reports; anonymises; ends sessions', async () => {
    const me = await as('USER');
    const name = me.user.username!;
    const item = await watchedItem();
    await postReview(me, item.id);
    const other = await makeReview(item.id);
    await like(me, other.id);

    const staleMe: Who = {
      user: me.user,
      auth: await (
        await import('../support/http')
      ).signedIn(me.user, new Date(Date.now() - 60 * 60_000)),
    };
    expect(
      (await hit(eraseRoute, 'POST', '', { who: staleMe, body: { confirmUsername: name } })).json
        .code,
    ).toBe('STEP_UP_REQUIRED');
    expect(
      (await hit(eraseRoute, 'POST', '', { who: me, body: { confirmUsername: 'outro' } })).json
        .code,
    ).toBe('CONFIRMATION_MISMATCH');

    const r = await hit(eraseRoute, 'POST', '', {
      who: me,
      body: { confirmUsername: name.toUpperCase() },
    });
    expect(r.json).toEqual({ erased: true });
    expect(r.res.headers.getSetCookie().join(';')).toMatch(/__Host-wf_session=;/);
    const u = await db().user.findUniqueOrThrow({ where: { id: me.user.id } });
    expect(u).toMatchObject({ status: 'DELETED', role: 'USER', isVip: false });
    expect(u.username).toMatch(/^removido_[a-z0-9]{8}$/);
    expect(u.email).not.toContain('example.com');
    expect(u.googleSub).toBe(`deleted:${me.user.id}`);
    expect(await db().review.count({ where: { userId: me.user.id } })).toBe(0);
    expect(await db().reviewLike.count({ where: { userId: me.user.id } })).toBe(0);
    expect((await db().review.findUniqueOrThrow({ where: { id: other.id } })).likeCount).toBe(0);
    expect(await loadSession(me.auth.token)).toBeNull();
    // the old username is held for 30 days
    expect(await db().usernameHold.findUnique({ where: { username: name } })).not.toBeNull();
  });

  it("the streamer account can't be erased here", async () => {
    const s = await as('STREAMER');
    const r = await hit(eraseRoute, 'POST', '', {
      who: s,
      body: { confirmUsername: s.user.username! },
    });
    expect(r.json.code).toBe('STREAMER_ACCOUNT');
  });
});
