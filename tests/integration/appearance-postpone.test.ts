/**
 * 2026-11-10: the seasonal theme, the home pop-up (once per visitor per activation) and "Adiar"
 * on the live agenda (this live, or this one and every planned live after it).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PUT as popupRoute } from '@/app/api/v1/admin/popup/route';
import { PUT as seasonRoute } from '@/app/api/v1/admin/season/route';
import { POST as postponeRoute } from '@/app/api/v1/admin/sessions/[id]/postpone/route';
import { POST as scheduleRoute } from '@/app/api/v1/admin/schedule/route';
import { db } from '@/server/db';
import { activeTheme, currentSeason, homePopup, popupInput } from '@/server/site/appearance';
import { clearCatalog, makeAsset } from '../support/catalog';
import { as, hit, makeSession, paidMovie, resetSlots, type Who } from '../support/live';

const DAY = 86_400_000;

beforeEach(async () => {
  await clearCatalog();
  await db().streamSession.deleteMany({});
  await db().appSetting.deleteMany({ where: { key: { in: ['season', 'popup'] } } });
  resetSlots();
});

const putSeason = (who: Who, body: unknown) =>
  hit(seasonRoute, 'PUT', '/api/v1/admin/season', { who, body });
const putPopup = (who: Who, body: Record<string, unknown>) =>
  hit(popupRoute, 'PUT', '/api/v1/admin/popup', {
    who,
    body: {
      active: true,
      title: 'Feliz Natal!',
      body: 'Live especial dia 24.\nTraga a pipoca.',
      imageId: null,
      ctaLabel: null,
      ctaHref: null,
      until: null,
      ...body,
    },
  });
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

describe('seasonal theme', () => {
  it('switched on and off from the admin panel, audited, with an optional last day', async () => {
    const mod = await as('MODERATOR');
    expect(await currentSeason()).toBeNull();
    let r = await putSeason(mod, { theme: 'natal', until: null });
    expect(r.res.status).toBe(200);
    expect(r.json.season).toEqual({ theme: 'natal', until: null });
    expect(await currentSeason()).toBe('natal');

    r = await putSeason(mod, { theme: 'halloween', until: today() });
    expect(r.json.season).toEqual({ theme: 'halloween', until: today() });
    expect(await currentSeason()).toBe('halloween');
    // the day after its last day, it is off by itself
    expect(
      activeTheme({ theme: 'halloween', until: '2026-10-31' }, new Date('2026-11-01T03:30:00Z')),
    ).toBeNull();
    expect(
      activeTheme({ theme: 'halloween', until: '2026-10-31' }, new Date('2026-11-01T02:30:00Z')),
    ).toBe('halloween');

    r = await putSeason(mod, { theme: 'aniversario', until: '2020-01-01' });
    expect(r.res.status).toBe(422);
    r = await putSeason(mod, { theme: 'pascoa', until: null });
    expect(r.res.status).toBe(422);
    r = await putSeason(mod, { theme: 'none', until: '2099-01-01' });
    expect(r.json.season).toEqual({ theme: 'none', until: null });
    expect(await currentSeason()).toBeNull();

    const audits = await db().auditLog.findMany({
      where: { action: 'season.update', actorId: mod.user.id },
      orderBy: { id: 'asc' },
    });
    expect(audits.map((a) => (a.metadata as { theme: string }).theme)).toEqual([
      'natal',
      'halloween',
      'none',
    ]);
  });

  it('plain viewers cannot change it (admin routes look absent to them)', async () => {
    const fan = await as('USER');
    const r = await putSeason(fan, { theme: 'natal', until: null });
    expect(r.res.status).toBe(404);
    expect(await currentSeason()).toBeNull();
  });
});

describe('home pop-up', () => {
  it('a new id each time it is switched on; editing while on keeps it', async () => {
    const mod = await as('STREAMER');
    expect(await homePopup()).toBeNull();
    const on = await putPopup(mod, {});
    expect(on.res.status).toBe(200);
    const first = (on.json.popup as { id: string }).id;
    const shown = await homePopup();
    expect(shown).toMatchObject({
      id: first,
      title: 'Feliz Natal!',
      body: 'Live especial dia 24.\nTraga a pipoca.',
      image: null,
      cta: null,
    });

    // a fix to the text while it is on: same id (people who closed it don't see it again)
    await putPopup(mod, { title: 'Feliz Natal, galera!' });
    expect((await homePopup())?.id).toBe(first);
    expect((await homePopup())?.title).toBe('Feliz Natal, galera!');

    // off: nothing on the home page; on again: a new id
    await putPopup(mod, { active: false });
    expect(await homePopup()).toBeNull();
    await putPopup(mod, {});
    const second = (await homePopup())!.id;
    expect(second).not.toBe(first);

    // "Mostrar de novo para todos"
    await putPopup(mod, { renew: true });
    expect((await homePopup())!.id).not.toBe(second);

    const audits = await db().auditLog.findMany({
      where: { action: 'popup.update', actorId: mod.user.id },
      orderBy: { id: 'asc' },
    });
    expect(audits.map((a) => (a.metadata as { renewed: boolean }).renewed)).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
  });

  it('button, image and dates are checked', async () => {
    const mod = await as('MODERATOR');
    const ok = (h: string) => popupInput.shape.ctaHref.safeParse(h).success;
    expect(ok('/cronograma')).toBe(true);
    expect(ok('https://www.twitch.tv/iarawiski')).toBe(true);
    expect(ok('//evil.example')).toBe(false);
    expect(ok(['javascript', 'alert(1)'].join(':'))).toBe(false);
    expect(ok('http://insecure.example')).toBe(false);

    expect((await putPopup(mod, { ctaLabel: 'Ver', ctaHref: null })).res.status).toBe(422);
    expect((await putPopup(mod, { title: '' })).res.status).toBe(422);
    expect((await putPopup(mod, { until: '2020-01-01' })).res.status).toBe(422);
    const poster = await makeAsset('POSTER');
    expect((await putPopup(mod, { imageId: poster.id })).res.status).toBe(422);

    const wide = await makeAsset('BACKDROP');
    const r = await putPopup(mod, {
      imageId: wide.id,
      ctaLabel: 'Ver a agenda',
      ctaHref: '/cronograma',
      title: '  Natal\u200b  ',
    });
    expect(r.res.status).toBe(200);
    const p = await homePopup();
    expect(p?.image).not.toBeNull();
    expect(p?.cta).toEqual({ label: 'Ver a agenda', href: '/cronograma' });
    expect(p?.title).toBe('Natal'); // plain text, trimmed, invisible characters out
  });
});

describe('Adiar (postpone the agenda)', () => {
  const at = (s: { startsAt: Date }) => s.startsAt.getTime();

  it('this live and every planned one after it move by the same days; bookings go along', async () => {
    const mod = await as('MODERATOR');
    const a = await makeSession({ inHours: -2 }); // missed: today, two hours ago
    const b = await makeSession({ inHours: 22 });
    const c = await makeSession({ inHours: 46 });
    const before = await makeSession({ inHours: -30 }); // earlier: stays
    const { order } = await paidMovie({ title: 'Duna' });
    const booked = await hit(scheduleRoute, 'POST', '/api/v1/admin/schedule', {
      who: mod,
      body: {
        action: 'add',
        target: { kind: 'ORDER', id: order.id, expectedVersion: order.version },
        sessionId: b.id,
      },
    });
    expect(booked.res.status).toBe(200);

    const r = await hit(postponeRoute, 'POST', `/api/v1/admin/sessions/${a.id}/postpone`, {
      who: mod,
      params: { id: a.id },
      body: { expectedVersion: a.version, days: 1, cascade: true },
    });
    expect(r.res.status).toBe(200);
    expect(r.json).toEqual({ moved: 3 });
    const get = (id: string) => db().streamSession.findUniqueOrThrow({ where: { id } });
    const a2 = await get(a.id);
    const b2 = await get(b.id);
    const c2 = await get(c.id);
    const before2 = await get(before.id);
    expect(at(a2) - at(a)).toBe(DAY);
    expect(at(b2) - at(b)).toBe(DAY);
    expect(at(c2) - at(c)).toBe(DAY);
    expect(at(before2)).toBe(at(before));
    expect(a2.version).toBe(a.version + 1);
    const moved = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(moved).toMatchObject({ sessionId: b.id, status: 'SCHEDULED', rescheduleCount: 0 });

    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'session.postpone', targetId: a.id },
    });
    expect(log.metadata).toEqual({ days: 1, cascade: true, sessions: 3 });
  });

  it('"Só esta" moves one; live, stale versions and bad day counts are refused', async () => {
    const mod = await as('STREAMER');
    const a = await makeSession({ inHours: 24 });
    const b = await makeSession({ inHours: 48 });
    const post = (id: string, body: object) =>
      hit(postponeRoute, 'POST', `/api/v1/admin/sessions/${id}/postpone`, {
        who: mod,
        params: { id },
        body,
      });
    let r = await post(a.id, { expectedVersion: a.version, days: 3, cascade: false });
    expect(r.json).toEqual({ moved: 1 });
    expect(at(await db().streamSession.findUniqueOrThrow({ where: { id: a.id } })) - at(a)).toBe(
      3 * DAY,
    );
    expect(at(await db().streamSession.findUniqueOrThrow({ where: { id: b.id } }))).toBe(at(b));

    r = await post(a.id, { expectedVersion: a.version, days: 1, cascade: false }); // stale
    expect(r.res.status).toBe(409);
    expect(r.json.code).toBe('SCHEDULE_CHANGED');
    r = await post(b.id, { expectedVersion: b.version, days: 0, cascade: true });
    expect(r.res.status).toBe(422);
    r = await post(b.id, { expectedVersion: b.version, days: 15, cascade: true });
    expect(r.res.status).toBe(422);

    const live = await makeSession({ inHours: 0, status: 'LIVE' });
    r = await post(live.id, { expectedVersion: live.version, days: 1, cascade: true });
    expect(r.res.status).toBe(409);
    expect(r.json.code).toBe('INVALID_STATE');
  });
});
