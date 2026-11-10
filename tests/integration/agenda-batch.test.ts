/**
 * Agenda and operations batch (2026-11-09): a session's entries in a hand-made order ("↑/↓"),
 * "Limpar encerradas e canceladas", a poster on a custom event, "Desmarcar assistido" and
 * !proximo. Plus the database rules behind them and the 50-series limit.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as unwatchedRoute } from '@/app/api/v1/admin/catalog/items/[id]/unwatched/route';
import { POST as watchedRoute } from '@/app/api/v1/admin/catalog/items/[id]/watched/route';
import { POST as scheduleRoute } from '@/app/api/v1/admin/schedule/route';
import { POST as clearRoute } from '@/app/api/v1/admin/sessions/clear/route';
import { POST as orderRoute } from '@/app/api/v1/admin/sessions/[id]/order/route';
import * as commandRoute from '@/app/api/v1/subathon/command/route';
import { LIVE_LIMIT } from '@/lib/catalog/pricing';
import { db } from '@/server/db';
import { cronograma, nextUpAnswer } from '@/server/live/public';
import { queue, sessionsWithEntries } from '@/server/live/schedule';
import { createCommandKey } from '@/server/subathon/command';
import { clearCatalog, makeAsset } from '../support/catalog';
import { withAdmin } from '../support/db';
import { call, req } from '../support/http';
import {
  as,
  fundedCampaign,
  hit,
  makeSession,
  paidMovie,
  resetSlots,
  type Who,
} from '../support/live';

beforeEach(async () => {
  await clearCatalog();
  await db().streamSession.deleteMany({});
  await db().appSetting.deleteMany({ where: { key: 'subathon.commandKey' } });
  resetSlots();
});

const schedule = (who: Who, body: unknown) =>
  hit(scheduleRoute, 'POST', '/api/v1/admin/schedule', { who, body });

async function book(who: Who, orderId: string, sessionId: string) {
  const o = await db().order.findUniqueOrThrow({ where: { id: orderId } });
  const r = await schedule(who, {
    action: 'add',
    target: { kind: 'ORDER', id: o.id, expectedVersion: o.version },
    sessionId,
  });
  expect(r.res.status).toBe(200);
}

async function event(who: Who, sessionId: string, title: string, extra: object = {}) {
  const r = await schedule(who, { action: 'event', sessionId, title, minutes: 30, ...extra });
  return r;
}

const titles = async (sessionId: string) => {
  const [s] = (await sessionsWithEntries({ from: new Date(0), take: 50 })).filter(
    (x) => x.id === sessionId,
  );
  return s!.entries.map((e) => e.item?.title ?? e.segment?.label);
};

describe('"↑/↓": a session in a hand-made order', () => {
  it('saves the order, keeps new entries after it, and refuses a stale or foreign list', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession({ inHours: 24, capacity: 600 });
    const a = await paidMovie({ title: 'Alfa', paidAt: new Date(Date.now() - 3_000) });
    const b = await paidMovie({ title: 'Beta', paidAt: new Date(Date.now() - 2_000) });
    await book(mod, a.order.id, s.id);
    await book(mod, b.order.id, s.id);
    expect((await event(mod, s.id, 'Jogando com os Viewers')).res.status).toBe(200);
    expect(await titles(s.id)).toEqual(['Alfa', 'Beta', 'Jogando com os Viewers']);

    const [row] = (await sessionsWithEntries({ from: new Date(0) })).filter((x) => x.id === s.id);
    const keys = row!.entries.map((e) => `${e.kind}:${e.id}`);
    const wanted = [keys[2]!, keys[0]!, keys[1]!];
    const r = await hit(orderRoute, 'POST', '', {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: row!.version, entries: wanted },
    });
    expect(r.res.status).toBe(200);
    expect(await titles(s.id)).toEqual(['Jogando com os Viewers', 'Alfa', 'Beta']);

    // added later → after the ordered ones
    const c = await paidMovie({ title: 'Gama' });
    await book(mod, c.order.id, s.id);
    expect(await titles(s.id)).toEqual(['Jogando com os Viewers', 'Alfa', 'Beta', 'Gama']);

    // the version the moderator saw is checked; a key from another session is refused
    const stale = await hit(orderRoute, 'POST', '', {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: row!.version, entries: wanted },
    });
    expect(stale.json.code).toBe('SCHEDULE_CHANGED');
    const fresh = await db().streamSession.findUniqueOrThrow({ where: { id: s.id } });
    const other = await paidMovie({ title: 'De outra sessão' });
    const foreign = await hit(orderRoute, 'POST', '', {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: fresh.version, entries: [`ORDER:${other.order.id}`] },
    });
    expect(foreign.json.code).toBe('SCHEDULE_CHANGED');
    expect(
      (await db().auditLog.count({ where: { action: 'session.reorder', targetId: s.id } })) >= 1,
    ).toBe(true);

    // the public schedule follows the same order
    const day = (await cronograma()).flatMap((d) => d.sessions).find((x) => x.id === s.id)!;
    expect(day.titles.map((t) => t.title)).toEqual([
      'Jogando com os Viewers',
      'Alfa',
      'Beta',
      'Gama',
    ]);
  });
});

describe('"Limpar encerradas e canceladas"', () => {
  it('hides only DONE and CANCELLED sessions; what was watched on them stays', async () => {
    const mod = await as('MODERATOR');
    const planned = await makeSession({ inHours: 24 });
    const done = await db().streamSession.create({
      data: {
        startsAt: new Date(Date.now() - 2 * 3_600_000),
        capacityMinutes: 120,
        status: 'DONE',
        startedAt: new Date(Date.now() - 2 * 3_600_000),
        endsAt: new Date(Date.now() - 3_600_000),
      },
    });
    const cancelled = await db().streamSession.create({
      data: {
        startsAt: new Date(Date.now() + 3_600_000),
        capacityMinutes: 120,
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });
    const r = await hit(clearRoute, 'POST', '/api/v1/admin/sessions/clear', { who: mod });
    expect(r.res.status).toBe(200);
    expect(r.json.hidden).toBe(2);
    const ids = (await sessionsWithEntries({ from: new Date(0), take: 50 })).map((s) => s.id);
    expect(ids).toContain(planned.id);
    expect(ids).not.toContain(done.id);
    expect(ids).not.toContain(cancelled.id);
    expect(await db().streamSession.count({ where: { id: { in: [done.id, cancelled.id] } } })).toBe(
      2,
    );
    // running it again hides nothing new
    expect((await hit(clearRoute, 'POST', '', { who: mod })).json.hidden).toBe(0);
  });
});

describe('a poster on a custom event', () => {
  it('is uploaded with the event, shown on the Cronograma, changed and removed', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession({ inHours: 24 });
    const poster = await makeAsset('POSTER');
    const created = await event(mod, s.id, 'Jogando com os Viewers', { posterId: poster.id });
    expect(created.res.status).toBe(200);
    const id = (created.json.segment as { id: string }).id;
    let g = await db().liveSegment.findUniqueOrThrow({ where: { id } });
    expect(g.posterId).toBe(poster.id);

    const t = (await cronograma()).flatMap((d) => d.sessions).flatMap((x) => x.titles)[0]!;
    expect(t.kind).toBe('EVENT');
    expect(t.poster?.fallback).toMatch(/^\/media\//);

    // a backdrop is not a poster
    const wide = await makeAsset('BACKDROP');
    const bad = await schedule(mod, {
      action: 'event-poster',
      target: { kind: 'SEGMENT', id, expectedVersion: g.version },
      posterId: wide.id,
    });
    expect(bad.res.status).toBe(422);

    const off = await schedule(mod, {
      action: 'event-poster',
      target: { kind: 'SEGMENT', id, expectedVersion: g.version },
      posterId: null,
    });
    expect(off.res.status).toBe(200);
    g = await db().liveSegment.findUniqueOrThrow({ where: { id } });
    expect(g.posterId).toBeNull();
    expect(g.version).toBe(1);
  });

  it('a part of a series cannot carry one', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession({ inHours: 24 });
    const { campaign } = await fundedCampaign();
    await db().catalogItem.update({
      where: { id: campaign.itemId },
      data: { seasonCount: 1, episodeCount: 10 },
    });
    const part = await schedule(mod, {
      action: 'part',
      campaignId: campaign.id,
      sessionId: s.id,
      season: 1,
      episodeFrom: 1,
      episodeTo: 2,
      minutes: 90,
    });
    const id = (part.json.segment as { id: string }).id;
    const r = await schedule(mod, {
      action: 'event-poster',
      target: { kind: 'SEGMENT', id, expectedVersion: 0 },
      posterId: (await makeAsset('POSTER')).id,
    });
    expect(r.res.status).toBe(409);
  });
});

describe('"Desmarcar assistido"', () => {
  it('a sponsored movie goes back to the queue with its order PAID; reviews close again', async () => {
    const mod = await as('MODERATOR');
    const { item, order } = await paidMovie({ title: 'Engano' });
    const w = await hit(watchedRoute, 'POST', '', { who: mod, params: { id: item.id } });
    expect(w.res.status).toBe(200);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'COMPLETED',
    );
    expect(await db().watchEvent.count({ where: { itemId: item.id } })).toBe(1);

    const current = await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } });
    const r = await hit(unwatchedRoute, 'POST', '', {
      who: mod,
      params: { id: item.id },
      body: { expectedVersion: current.version },
    });
    expect(r.res.status).toBe(200);
    const back = await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([back.status, back.watchedAt]).toEqual(['SPONSORED', null]);
    const o = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect([o.status, o.completedAt, o.sessionId]).toEqual(['PAID', null, null]);
    expect(await db().watchEvent.count({ where: { itemId: item.id } })).toBe(0);
    expect((await queue()).map((e) => e.item?.title)).toContain('Engano');
    expect(
      await db().auditLog.count({ where: { action: 'catalog.unwatched', targetId: item.id } }),
    ).toBe(1);

    // not watched any more → nothing to undo
    const again = await hit(unwatchedRoute, 'POST', '', {
      who: mod,
      params: { id: item.id },
      body: { expectedVersion: current.version },
    });
    expect(again.res.status).toBe(409);
  });

  it('a watched series goes back to FUNDED and into the queue', async () => {
    const mod = await as('MODERATOR');
    const { item, campaign } = await fundedCampaign();
    await hit(watchedRoute, 'POST', '', { who: mod, params: { id: item.id } });
    expect((await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      'WATCHED',
    );
    const current = await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } });
    const r = await hit(unwatchedRoute, 'POST', '', {
      who: mod,
      params: { id: item.id },
      body: { expectedVersion: current.version },
    });
    expect(r.res.status).toBe(200);
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'FUNDED',
    );
    const c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect([c.status, c.sessionId]).toEqual(['FUNDED', null]);
    expect((await queue()).some((e) => e.kind === 'CAMPAIGN' && e.id === campaign.id)).toBe(true);
  });
});

describe('!proximo', () => {
  const run = (k: string) =>
    call(commandRoute.GET, req('GET', `/api/v1/subathon/command?a=proximo&k=${k}`));

  it('answers with the next title on the live, else the next planned live with its date', async () => {
    const mod = await as('MODERATOR');
    const key = await createCommandKey({ actor: mod.user, requestId: null });
    expect(await (await run(key)).text()).toBe('Nada agendado na agenda da live por enquanto.');

    const planned = await makeSession({ inHours: 30 });
    const a = await paidMovie({ title: 'Depois' });
    await book(mod, a.order.id, planned.id);
    expect(await nextUpAnswer()).toMatch(/^⏭️ Próximo na live: Depois \(.+\)$/);

    const live = await makeSession({ inHours: 0, status: 'LIVE' });
    await event(mod, live.id, 'Abertura');
    const b = await paidMovie({ title: 'Agora não' });
    await book(mod, b.order.id, live.id);
    const res = await run(key);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('⏭️ Próximo na live: Abertura');

    // a wrong key is 401
    expect((await run(`wfc_${'A'.repeat(43)}`)).status).toBe(401);
  });
});

describe('database rules', () => {
  it('50 series can be live; only a finished session can be hidden; posters only on events', async () => {
    expect(LIVE_LIMIT.SERIES).toBe(50);
    const s = await makeSession({ inHours: 5 });
    await withAdmin(async (c) => {
      await expect(
        c.query(`UPDATE "StreamSession" SET "hiddenAt" = now() WHERE id = $1`, [s.id]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        c.query(`UPDATE "StreamSession" SET "entryOrder" = ARRAY['HACK:1'] WHERE id = $1`, [s.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });
    const { campaign } = await fundedCampaign();
    const part = await db().liveSegment.create({
      data: {
        sessionId: s.id,
        kind: 'PART',
        campaignId: campaign.id,
        label: 'T1 · E1',
        seasonNumber: 1,
        episodeFrom: 1,
        episodeTo: 1,
        minutes: 45,
      },
    });
    const poster = await makeAsset('POSTER');
    await withAdmin(async (c) => {
      await expect(
        c.query(`UPDATE "LiveSegment" SET "posterId" = $2 WHERE id = $1`, [part.id, poster.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
