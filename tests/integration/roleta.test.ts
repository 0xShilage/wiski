/**
 * Roleta (2026-11-04): 5 spins per period (17:00 BRT, not cumulative, parallel-safe), the prizes
 * (coupon voucher at once, movies/VIP by hand), the winner's Twitch login, Admin › Roleta
 * (never "Nada", compare-and-set, streamer-only cancel), the on/off switch, LGPD and the reviewed
 * SQL (prisma/migrations/*_roleta_constraints).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { pgErrorCode, PG } from '@/server/db-errors';
import { ROLETA_SLICES } from '@/lib/roleta';
import {
  listRoletaPrizes,
  myRoleta,
  purgeRoletaNada,
  setRoletaStatus,
  setTwitchLogin,
  spinRoleta,
} from '@/server/roleta/roleta';
import { eraseMyAccount, exportMyData } from '@/server/users/lgpd';
import { GET as roletaRoute } from '@/app/api/v1/roleta/route';
import { POST as spinRoute } from '@/app/api/v1/roleta/spin/route';
import { PATCH as prizeRoute } from '@/app/api/v1/roleta/prizes/[id]/route';
import { GET as adminListRoute } from '@/app/api/v1/admin/roleta/route';
import { PATCH as adminPatchRoute } from '@/app/api/v1/admin/roleta/[id]/route';
import { PUT as openRoute } from '@/app/api/v1/admin/roleta/open/route';
import { makeUser } from '../support/db';
import { freshIp } from '../support/http';
import { as, hit, type Who } from '../support/live';

/** draw values: CUPOM_30 0…99, FILME 100…129, DOIS_FILMES 130…144, VIP_TWITCH 145…150 */
const rng = (draw: number, nadaPick = 0) => ({ draw: () => draw, nadaPick: () => nadaPick });
const NADA = rng(9_999);
const COUPON = rng(0);
const FILME = rng(100);
const DOIS = rng(130);
const VIP = rng(150);
const HOUR = 3_600_000;
/** 2026-11-01 15:00 BRT (in the past: staff actions use the real clock) */
const T0 = new Date('2026-11-01T18:00:00Z');

beforeEach(async () => {
  await db().roletaSpin.deleteMany({});
  await db().appSetting.deleteMany({ where: { key: 'roleta.open' } });
});

const spin = (who: Who) =>
  hit(spinRoute, 'POST', '/api/v1/roleta/spin', { who, body: {}, ip: freshIp() });

describe('spins', () => {
  it('5 per period through the API; each answer names a slice that shows its prize; the 6th → 409', async () => {
    const v = await as('USER');
    expect((await hit(spinRoute, 'POST', '/api/v1/roleta/spin', { body: {} })).res.status).toBe(
      401,
    );
    for (let i = 1; i <= 5; i++) {
      const r = await spin(v);
      expect(r.res.status).toBe(200);
      const slot = r.json.slot as number;
      expect(ROLETA_SLICES[slot]).toBe(r.json.prize);
      expect((r.json.view as { spinsLeft: number }).spinsLeft).toBe(5 - i);
    }
    const sixth = await spin(v);
    expect(sixth.res.status).toBe(409);
    expect(sixth.json.code).toBe('ROLETA_NO_SPINS');
    const me = await hit(roletaRoute, 'GET', '/api/v1/roleta', { who: v });
    expect(me.json.spinsLeft).toBe(0);
    expect(await db().roletaSpin.count({ where: { userId: v.user.id } })).toBe(5);
  });

  it('they renew at 17:00 BRT and do not stack: 5 again, never 10', async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) await spinRoleta(u, null, T0, NADA);
    await expect(
      spinRoleta(u, null, new Date(T0.getTime() + 2 * HOUR - 1), NADA),
    ).rejects.toMatchObject({
      code: 'ROLETA_NO_SPINS',
    });
    // 17:00 BRT: a new period
    const five = new Date(T0.getTime() + 2 * HOUR);
    expect((await myRoleta(u.id, five)).spinsLeft).toBe(5);
    // a whole day skipped: still 5 (unused spins don't carry over)
    const later = new Date(T0.getTime() + 50 * HOUR);
    expect((await myRoleta(u.id, later)).spinsLeft).toBe(5);
    for (let i = 0; i < 5; i++) await spinRoleta(u, null, later, NADA);
    await expect(spinRoleta(u, null, later, NADA)).rejects.toMatchObject({
      code: 'ROLETA_NO_SPINS',
    });
    const v = await myRoleta(u.id, later);
    expect(v.nextAt).toBe('2026-11-04T20:00:00.000Z');
  });

  it('parallel spins can not beat the limit: exactly 5 land, numbered 1…5', async () => {
    const u = await makeUser();
    const out = await Promise.allSettled(
      Array.from({ length: 9 }, () => spinRoleta(u, null, T0, NADA)),
    );
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(5);
    for (const o of out.filter((o) => o.status === 'rejected')) {
      expect(['ROLETA_NO_SPINS', 'ROLETA_BUSY']).toContain(
        ((o as PromiseRejectedResult).reason as { code: string }).code,
      );
    }
    const ns = await db().roletaSpin.findMany({ where: { userId: u.id }, select: { n: true } });
    expect(ns.map((r) => r.n).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('no username → 409; suspended → 403; closed by the streamer → 409 for everyone', async () => {
    const fresh = await makeUser({ username: null });
    await expect(spinRoleta(fresh, null, T0, NADA)).rejects.toMatchObject({
      code: 'ONBOARDING_REQUIRED',
    });
    const sus = await makeUser({ status: 'SUSPENDED' });
    await expect(spinRoleta(sus, null, T0, NADA)).rejects.toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
    });

    const st = await as('STREAMER');
    const v = await as('USER');
    const off = await hit(openRoute, 'PUT', '/api/v1/admin/roleta/open', {
      who: st,
      body: { open: false },
    });
    expect(off.json).toEqual({ open: false });
    const r = await spin(v);
    expect(r.res.status).toBe(409);
    expect(r.json.code).toBe('ROLETA_CLOSED');
    expect((await myRoleta(v.user.id)).open).toBe(false);
    const audited = await db().auditLog.findFirst({
      where: { action: 'settings.update', targetId: 'roleta.open' },
      orderBy: { id: 'desc' },
    });
    expect(audited?.metadata).toEqual({ key: 'roleta.open', value: false });
    await hit(openRoute, 'PUT', '/api/v1/admin/roleta/open', { who: st, body: { open: true } });
    expect((await spin(v)).res.status).toBe(200);
  });
});

describe('prizes', () => {
  it('a coupon is a personal 30 % voucher at once: one use, 30 days, shown to the winner; audited', async () => {
    const u = await makeUser();
    const r = await spinRoleta(u, null, T0, COUPON);
    expect(r).toMatchObject({ prize: 'CUPOM_30', slot: 2 });
    expect(r.won?.status).toBe('DELIVERED');
    expect(r.won?.coupon?.code).toMatch(/^ROLETA-[A-Z2-9]{8}$/);
    const row = await db().roletaSpin.findFirstOrThrow({
      where: { userId: u.id },
      include: { voucher: true },
    });
    expect(row.voucher).toMatchObject({
      kind: 'PERCENT',
      percentBps: 3000,
      maxRedemptions: 1,
      maxPerUser: 1,
      active: true,
    });
    expect(row.voucher!.endsAt!.getTime() - T0.getTime()).toBe(30 * 24 * HOUR);
    expect(row.deliveredAt?.getTime()).toBe(T0.getTime());
    const a = await db().auditLog.findFirst({
      where: { action: 'roleta.win', targetId: row.id },
    });
    expect(a?.metadata).toEqual({ prize: 'CUPOM_30' }); // never the code
    expect((await myRoleta(u.id, T0)).prizes[0]?.coupon?.code).toBe(r.won?.coupon?.code);
  });

  it('movies and VIP wait for the streamer; the winner saves a valid Twitch login, only on their own prize', async () => {
    const owner = await as('USER');
    const other = await as('USER');
    const f = await spinRoleta(owner.user, null, T0, FILME);
    expect(f).toMatchObject({ prize: 'FILME', slot: 0, won: { status: 'PENDING', coupon: null } });
    expect((await spinRoleta(owner.user, null, T0, DOIS)).slot).toBe(6);
    expect((await spinRoleta(owner.user, null, T0, VIP)).slot).toBe(4);
    const id = f.won!.id;
    const patch = (who: Who, twitchLogin: string) =>
      hit(prizeRoute, 'PATCH', '', { who, params: { id }, body: { twitchLogin }, ip: freshIp() });
    expect((await patch(owner, 'ab')).res.status).toBe(422);
    expect((await patch(owner, 'nome com espaço')).res.status).toBe(422);
    expect((await patch(other, 'intruso')).res.status).toBe(404);
    const ok = await patch(owner, '  @Iara_Wiski ');
    expect(ok.res.status).toBe(200);
    expect(ok.json.twitchLogin).toBe('iara_wiski');

    // "Nada" and coupons have no Twitch login
    const nada = await spinRoleta(owner.user, null, T0, NADA);
    expect(nada.won).toBeNull();
    const nadaRow = await db().roletaSpin.findFirstOrThrow({
      where: { userId: owner.user.id, prize: 'NADA' },
    });
    await expect(setTwitchLogin(owner.user, nadaRow.id, 'iara_wiski')).rejects.toMatchObject({
      status: 404,
    });

    // once delivered, it can't be changed
    const mod = await as('MODERATOR');
    await setRoletaStatus({ actor: mod.user, requestId: null }, id, {
      status: 'DELIVERED',
      expectedStatus: 'PENDING',
    });
    expect((await patch(owner, 'outro_nome')).json.code).toBe('ROLETA_NOT_PENDING');
  });
});

describe('Admin › Roleta', () => {
  it('lists prizes only (never "Nada"), by status; counts today and what waits', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await spinRoleta(a, null, T0, NADA);
    await spinRoleta(a, null, T0, FILME);
    await spinRoleta(b, null, T0, COUPON);
    await spinRoleta(b, null, T0, NADA);
    const mod = await as('MODERATOR');
    const r = await hit(adminListRoute, 'GET', '/api/v1/admin/roleta', { who: mod });
    expect(r.res.status).toBe(200);
    const pending = r.json.prizes as { prize: string; winner: string; label: string }[];
    expect(pending).toEqual([
      expect.objectContaining({ prize: 'FILME', winner: a.username, label: 'Filme grátis' }),
    ]);
    expect(r.json.pending).toBe(1);
    const delivered = await listRoletaPrizes({ status: 'DELIVERED' }, T0);
    expect(delivered.prizes.map((p) => p.prize)).toEqual(['CUPOM_30']);
    expect(delivered.prizes[0]?.coupon).toMatchObject({ used: false, active: true });
    expect(delivered.today).toEqual({ spins: 4, prizes: 2 });
    // viewers can't read it
    const v = await as('USER');
    expect((await hit(adminListRoute, 'GET', '/api/v1/admin/roleta', { who: v })).res.status).toBe(
      404,
    );
  });

  it('delivered / undo by moderators with compare-and-set; cancel (moderators too, since 2026-11-08) switches the coupon off', async () => {
    const u = await makeUser();
    const film = (await spinRoleta(u, null, T0, FILME)).won!;
    const coupon = (await spinRoleta(u, null, T0, COUPON)).won!;
    const mod = await as('MODERATOR');
    const st = await as('STREAMER');
    const move = (who: Who, id: string, status: string, expectedStatus: string) =>
      hit(adminPatchRoute, 'PATCH', '', { who, params: { id }, body: { status, expectedStatus } });

    expect((await move(mod, film.id, 'DELIVERED', 'PENDING')).res.status).toBe(200);
    const row = await db().roletaSpin.findUniqueOrThrow({ where: { id: film.id } });
    expect(row).toMatchObject({ status: 'DELIVERED', deliveredById: mod.user.id });
    // a second moderator who still saw PENDING
    const stale = await move(mod, film.id, 'DELIVERED', 'PENDING');
    expect(stale.res.status).toBe(409);
    expect(stale.json.code).toBe('ROLETA_CHANGED');
    expect((await move(mod, film.id, 'CANCELLED', 'PENDING')).json.code).toBe('ROLETA_CHANGED');
    expect((await move(mod, film.id, 'PENDING', 'DELIVERED')).res.status).toBe(200);
    expect(
      (await db().roletaSpin.findUniqueOrThrow({ where: { id: film.id } })).deliveredAt,
    ).toBeNull();

    // coupons: delivered by the system; only cancelling is possible
    expect((await move(mod, coupon.id, 'PENDING', 'DELIVERED')).json.code).toBe(
      'ROLETA_BAD_STATUS',
    );
    expect((await move(st, coupon.id, 'CANCELLED', 'DELIVERED')).res.status).toBe(200);
    const c = await db().roletaSpin.findUniqueOrThrow({
      where: { id: coupon.id },
      include: { voucher: true },
    });
    expect(c.status).toBe('CANCELLED');
    expect(c.voucher?.active).toBe(false);
    expect((await myRoleta(u.id, T0)).prizes.find((p) => p.id === coupon.id)?.coupon).toBeNull();
    // nothing comes back from CANCELLED
    expect((await move(st, coupon.id, 'DELIVERED', 'CANCELLED')).json.code).toBe(
      'ROLETA_BAD_STATUS',
    );
    const audits = await db().auditLog.findMany({
      where: { action: 'roleta.status', targetId: { in: [film.id, coupon.id] } },
    });
    expect(audits.map((a) => a.metadata)).toContainEqual({
      prize: 'CUPOM_30',
      from: 'DELIVERED',
      to: 'CANCELLED',
    });
  });
});

describe('retention and LGPD', () => {
  it('"Nada" spins go after 30 days; prizes stay', async () => {
    const u = await makeUser();
    const old = new Date(T0.getTime() - 31 * 24 * HOUR);
    await spinRoleta(u, null, old, NADA);
    await spinRoleta(u, null, old, FILME);
    await spinRoleta(u, null, T0, NADA);
    expect(await purgeRoletaNada(T0)).toBe(1);
    expect(
      (await db().roletaSpin.findMany({ where: { userId: u.id } })).map((r) => r.prize).sort(),
    ).toEqual(['FILME', 'NADA']);
  });

  it('the export lists the spins (with the coupon code); erasing the account deletes them and switches the coupon off', async () => {
    const u = await makeUser();
    await spinRoleta(u, null, T0, COUPON);
    await spinRoleta(u, null, T0, NADA);
    const data = await exportMyData(u, null);
    expect(data.roleta).toHaveLength(2);
    expect(data.roleta.find((r) => r.prize === 'CUPOM_30')?.couponCode).toMatch(/^ROLETA-/);
    const voucherId = (
      await db().roletaSpin.findFirstOrThrow({ where: { userId: u.id, prize: 'CUPOM_30' } })
    ).voucherId!;
    await eraseMyAccount(u, u.username!, null);
    expect(await db().roletaSpin.count({ where: { userId: u.id } })).toBe(0);
    expect((await db().voucher.findUniqueOrThrow({ where: { id: voucherId } })).active).toBe(false);
  });
});

describe('reviewed SQL', () => {
  async function rejects(p: Promise<unknown>, sqlstate: string = PG.checkViolation) {
    let err: unknown = null;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err, 'expected the database to refuse').not.toBeNull();
    const code = pgErrorCode(err) ?? (err as { code?: string }).code;
    if (sqlstate === PG.uniqueViolation) expect(['23505', 'P2002']).toContain(code);
    else expect(code).toBe(sqlstate);
  }
  const period = new Date('2026-11-04T00:00:00Z');

  it('n 1…5 and unique per period; each prize on its own slice; delivery and Twitch rules', async () => {
    const u = await makeUser();
    const base = { userId: u.id, period, prize: 'NADA' as const, slot: 1 };
    const spinRow = (over: Record<string, unknown>) =>
      db().roletaSpin.create({ data: { ...base, n: 1, ...over } as never });
    await rejects(spinRow({ n: 6 }));
    await rejects(spinRow({ n: 0 }));
    await spinRow({ n: 1 });
    await rejects(spinRow({ n: 1 }), PG.uniqueViolation);
    await rejects(spinRow({ n: 2, slot: 0 })); // "Nada" on the movie slice
    await rejects(spinRow({ n: 2, prize: 'FILME', slot: 1, status: 'PENDING' })); // movie on a "Nada" slice
    await rejects(spinRow({ n: 2, status: 'PENDING' })); // "Nada" with a delivery state
    await rejects(spinRow({ n: 2, prize: 'FILME', slot: 0 })); // a prize without one
    await rejects(
      spinRow({ n: 2, prize: 'CUPOM_30', slot: 2, status: 'DELIVERED', deliveredAt: new Date() }),
    ); // coupon without voucher
    await rejects(spinRow({ n: 2, prize: 'FILME', slot: 0, status: 'DELIVERED' })); // delivered without a time
    await rejects(
      spinRow({ n: 2, prize: 'FILME', slot: 0, status: 'PENDING', deliveredById: u.id }),
    );
    await rejects(
      spinRow({ n: 2, prize: 'FILME', slot: 0, status: 'PENDING', twitchLogin: 'Maiusculo' }),
    );
    await rejects(
      spinRow({ n: 2, prize: 'FILME', slot: 0, status: 'PENDING', twitchLogin: 'abc' }),
    );
    await spinRow({
      n: 2,
      prize: 'VIP_TWITCH',
      slot: 4,
      status: 'PENDING',
      twitchLogin: 'iara_wiski',
    });
  });
});
