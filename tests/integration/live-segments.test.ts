/**
 * Live segments (2026-11-04): a funded series is watched a few episodes per live and a franchise
 * one film per live; the campaign stays in the queue until its last part ("fim da série"), which
 * is when the title is watched and its reviews open. A custom event ("Jogando com os Viewers")
 * sits on a live with a length only. Capacity, "Agora assistindo", ending a live, the public
 * schedule, the title page card, the overlays and the database rules.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { cronograma, publicSchedule } from '@/server/live/public';
import { titleQueueStatus } from '@/server/live/position';
import { queue } from '@/server/live/schedule';
import { nowPlayingSnapshot, queueSnapshot } from '@/server/overlay/state';
import { POST as scheduleRoute } from '@/app/api/v1/admin/schedule/route';
import { POST as endRoute } from '@/app/api/v1/admin/sessions/[id]/end/route';
import { POST as startRoute } from '@/app/api/v1/admin/sessions/[id]/start/route';
import { clearCatalog, makeItem } from '../support/catalog';
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
  resetSlots();
});

const post = (who: Who, body: unknown) =>
  hit(scheduleRoute, 'POST', '/api/v1/admin/schedule', { who, body });

async function segment(id: string) {
  return db().liveSegment.findUniqueOrThrow({ where: { id } });
}
const seg = (g: { id: string; version: number }) => ({
  kind: 'SEGMENT',
  id: g.id,
  expectedVersion: g.version,
});

async function series(seasonCount = 3, episodeCount = 30) {
  const { item, campaign } = await fundedCampaign();
  await db().catalogItem.update({
    where: { id: item.id },
    data: { seasonCount, episodeCount, runtimeMinutes: 1350, title: 'Série Teste' },
  });
  return { item, campaign };
}

describe('a series watched a few episodes per live', () => {
  it('books parts on two lives, keeps the campaign in the queue, and finishes on the last part', async () => {
    const mod = await as('MODERATOR');
    const { item, campaign } = await series();
    const tonight = await makeSession({ inHours: 1, capacity: 300 });
    const later = await makeSession({ inHours: 72, capacity: 300 });

    const a = await post(mod, {
      action: 'part',
      campaignId: campaign.id,
      sessionId: tonight.id,
      season: 1,
      episodeFrom: 1,
      episodeTo: 3,
      minutes: 135,
    });
    expect(a.res.status).toBe(200);
    const b = await post(mod, {
      action: 'part',
      campaignId: campaign.id,
      sessionId: later.id,
      season: 1,
      episodeFrom: 4,
      episodeTo: 6,
      minutes: 135,
      note: 'Maratona!',
    });
    expect(b.res.status).toBe(200);
    const first = await segment((a.json.segment as { id: string }).id);
    expect(first).toMatchObject({ kind: 'PART', label: 'T1 · E1–E3', minutes: 135 });
    expect(
      (await db().streamSession.findUniqueOrThrow({ where: { id: tonight.id } })).bookedMinutes,
    ).toBe(135);

    // still in the queue, with its parts
    const q = (await queue()).find((e) => e.id === campaign.id);
    expect(q?.parts?.map((p) => [p.label, p.status])).toEqual([
      ['T1 · E1–E3', 'SCHEDULED'],
      ['T1 · E4–E6', 'SCHEDULED'],
    ]);
    expect(q?.plan).toMatchObject({ seasonCount: 3, episodeCount: 30 });

    // the title page and the public schedule show the next part
    expect(await titleQueueStatus(item)).toMatchObject({ kind: 'scheduled', part: 'T1 · E1–E3' });
    const upNext = await publicSchedule();
    expect(upNext[0]!.titles[0]).toMatchObject({
      title: 'Série Teste',
      part: 'T1 · E1–E3',
      kind: 'SERIES',
      done: false,
    });

    // live: on screen, then done (not the end)
    expect(
      (
        await hit(startRoute, 'POST', '', {
          who: mod,
          params: { id: tonight.id },
          body: { expectedVersion: 0 },
        })
      ).res.status,
    ).toBe(200);
    expect((await post(mod, { action: 'now', target: seg(first) })).res.status).toBe(200);
    expect(await titleQueueStatus(item)).toEqual({ kind: 'playing', part: 'T1 · E1–E3' });
    const live = await db().streamSession.findUniqueOrThrow({ where: { id: tonight.id } });
    expect(live.nowItemId).toBe(item.id);
    const agora = await nowPlayingSnapshot();
    expect(agora).toMatchObject({ type: 'now-playing', title: 'Série Teste · T1 · E1–E3' });
    const playing = await segment(first.id);
    expect((await post(mod, { action: 'complete', target: seg(playing) })).res.status).toBe(200);
    expect(await segment(first.id)).toMatchObject({ status: 'DONE' });
    expect((await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      'FUNDED',
    );
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'FUNDED',
    );
    expect(await db().watchEvent.count({ where: { itemId: item.id } })).toBe(0);

    const fresh = await db().streamSession.findUniqueOrThrow({ where: { id: tonight.id } });
    expect(
      (
        await hit(endRoute, 'POST', '', {
          who: mod,
          params: { id: tonight.id },
          body: { expectedVersion: fresh.version },
        })
      ).res.status,
    ).toBe(200);

    // the next live: the last part ends the series
    expect(
      (
        await hit(startRoute, 'POST', '', {
          who: mod,
          params: { id: later.id },
          body: { expectedVersion: 0 },
        })
      ).res.status,
    ).toBe(200);
    const second = await segment((b.json.segment as { id: string }).id);
    const fin = await post(mod, { action: 'complete', target: seg(second), finish: true });
    expect(fin.res.status).toBe(200);
    expect((await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      'WATCHED',
    );
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'WATCHED',
    );
    expect(await db().watchEvent.count({ where: { itemId: item.id, sessionId: later.id } })).toBe(
      1,
    );
    expect((await queue()).find((e) => e.id === campaign.id)).toBeUndefined();

    const logs = await db().auditLog.findMany({
      where: { targetType: 'LiveSegment', targetId: { in: [first.id, second.id] } },
      orderBy: { id: 'asc' },
    });
    expect(logs.map((l) => l.action)).toEqual([
      'segment.add',
      'segment.add',
      'segment.now',
      'segment.complete',
      'segment.complete',
    ]);
    expect(logs.at(-1)!.metadata).toEqual({ sessionId: later.id, finish: true });
  });

  it('refuses what does not fit, the wrong kind of part, and a campaign not funded', async () => {
    const mod = await as('MODERATOR');
    const { campaign } = await series(2);
    const s = await makeSession({ capacity: 120 });
    const part = (extra: Record<string, unknown>) =>
      post(mod, {
        action: 'part',
        campaignId: campaign.id,
        sessionId: s.id,
        minutes: 60,
        ...extra,
      });

    expect((await part({ season: 1, episodeFrom: 1, episodeTo: 3, minutes: 200 })).json.code).toBe(
      'SESSION_FULL',
    );
    expect((await part({ film: 1 })).res.status).toBe(422);
    expect((await part({ season: 3, episodeFrom: 1 })).res.status).toBe(422);
    expect((await part({ season: 1, episodeFrom: 5, episodeTo: 2 })).res.status).toBe(422);
    expect((await part({ season: 1, episodeFrom: 1, unknown: true })).res.status).toBe(422);
    // one episode: "to" defaults to "from"
    const one = await part({ season: 2, episodeFrom: 7 });
    expect(one.res.status).toBe(200);
    expect(await segment((one.json.segment as { id: string }).id)).toMatchObject({
      label: 'T2 · E7',
    });

    await db().campaign.update({ where: { id: campaign.id }, data: { status: 'OPEN' } });
    expect((await part({ season: 1, episodeFrom: 1 })).json.code).toBe('INVALID_STATE');
    // a user is not staff
    const fan = await as('USER');
    expect(
      (await post(fan, { action: 'event', sessionId: s.id, title: 'Oi', minutes: 10 })).res.status,
    ).toBe(404);
  });
});

describe('a franchise watched one film per live', () => {
  it('books a film by position with its title, and a dashboard "assistido" drops the parts still booked', async () => {
    const mod = await as('MODERATOR');
    const item = await makeItem({
      kind: 'FRANCHISE',
      status: 'FUNDED',
      slot: 1,
      title: 'Saga Teste',
    });
    await db().franchiseEntry.createMany({
      data: [
        { franchiseId: item.id, position: 1, title: 'O Começo', runtimeMinutes: 120 },
        { franchiseId: item.id, position: 2, title: 'O Retorno', runtimeMinutes: 130 },
      ],
    });
    const opener = (await as('STREAMER')).user;
    const campaign = await db().campaign.create({
      data: {
        itemId: item.id,
        goalCents: 5000,
        raisedCents: 5000,
        remainingCents: 0,
        deadlineAt: new Date(Date.now() + 30 * 86_400_000),
        status: 'FUNDED',
        openedAt: new Date(),
        openedById: opener.id,
        fundedAt: new Date(),
      },
    });
    const s = await makeSession({ capacity: 300 });
    const r = await post(mod, {
      action: 'part',
      campaignId: campaign.id,
      sessionId: s.id,
      film: 2,
      minutes: 130,
    });
    expect(r.res.status).toBe(200);
    const g = await segment((r.json.segment as { id: string }).id);
    expect(g).toMatchObject({
      label: 'Filme 2: O Retorno',
      franchisePosition: 2,
      seasonNumber: null,
    });
    expect(
      (
        await post(mod, {
          action: 'part',
          campaignId: campaign.id,
          sessionId: s.id,
          film: 9,
          minutes: 60,
        })
      ).res.status,
    ).toBe(422);
    expect(
      (
        await post(mod, {
          action: 'part',
          campaignId: campaign.id,
          sessionId: s.id,
          season: 1,
          episodeFrom: 1,
          minutes: 60,
        })
      ).res.status,
    ).toBe(422);

    // the whole franchise marked watched elsewhere: the booked film leaves the live
    const { completeInTx } = await import('@/server/live/schedule');
    await db().$transaction((t) => completeInTx(t, item.id, null, new Date()));
    expect(await segment(g.id)).toMatchObject({ status: 'SKIPPED' });
    expect(
      (await db().streamSession.findUniqueOrThrow({ where: { id: s.id } })).bookedMinutes,
    ).toBe(0);
  });
});

describe('custom events', () => {
  it('"Jogando com os Viewers": booked, first on the live, removable, on the overlays', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession({ inHours: 2, capacity: 300 });
    const movie = await paidMovie({ runtime: 100, title: 'Filme da Noite' });
    await db().order.update({
      where: { id: movie.order.id },
      data: {
        status: 'SCHEDULED',
        sessionId: s.id,
        scheduledAt: new Date(),
        version: { increment: 1 },
      },
    });
    await db().streamSession.update({ where: { id: s.id }, data: { bookedMinutes: 100 } });

    const e = await post(mod, {
      action: 'event',
      sessionId: s.id,
      title: '  Jogando com os Viewers  ',
      minutes: 90,
      atStart: true,
      note: 'Traga seu controle',
    });
    expect(e.res.status).toBe(200);
    const g = await segment((e.json.segment as { id: string }).id);
    expect(g).toMatchObject({
      kind: 'EVENT',
      label: 'Jogando com os Viewers',
      campaignId: null,
      atStart: true,
    });
    expect(
      (await db().streamSession.findUniqueOrThrow({ where: { id: s.id } })).bookedMinutes,
    ).toBe(190);

    const [up] = await publicSchedule();
    expect(up!.titles.map((t) => [t.kind, t.title, t.slug])).toEqual([
      ['EVENT', 'Jogando com os Viewers', null],
      ['MOVIE', 'Filme da Noite', movie.item.slug],
    ]);
    expect(up!.titles[0]!.note).toBe('Traga seu controle');
    // the movie's title page counts the event before it
    expect(await titleQueueStatus(movie.item)).toMatchObject({
      kind: 'scheduled',
      position: 2,
      total: 2,
    });
    const fila = await queueSnapshot();
    expect(fila).toMatchObject({ type: 'queue' });
    expect((fila as { items: { title: string }[] }).items[0]!.title).toBe('Jogando com os Viewers');

    // too long / too short titles are refused
    expect(
      (await post(mod, { action: 'event', sessionId: s.id, title: 'x', minutes: 10 })).res.status,
    ).toBe(422);
    expect(
      (await post(mod, { action: 'event', sessionId: s.id, title: 'Oi', minutes: 0 })).res.status,
    ).toBe(422);

    // finish: an event can't "end a series"
    const fresh = await db().streamSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(
      (
        await hit(startRoute, 'POST', '', {
          who: mod,
          params: { id: s.id },
          body: { expectedVersion: fresh.version },
        })
      ).res.status,
    ).toBe(200);
    expect((await post(mod, { action: 'complete', target: seg(g), finish: true })).res.status).toBe(
      422,
    );

    // on screen, then the movie takes over: one thing playing at a time
    expect((await post(mod, { action: 'now', target: seg(g) })).res.status).toBe(200);
    expect(await nowPlayingSnapshot()).toMatchObject({
      title: 'Jogando com os Viewers',
      kind: null,
    });
    const order = await db().order.findUniqueOrThrow({ where: { id: movie.order.id } });
    expect(
      (
        await post(mod, {
          action: 'now',
          target: { kind: 'ORDER', id: order.id, expectedVersion: order.version },
        })
      ).res.status,
    ).toBe(200);
    expect(await segment(g.id)).toMatchObject({ status: 'SCHEDULED' });
    expect(await nowPlayingSnapshot()).toMatchObject({ title: 'Filme da Noite' });

    // remove it before it's on
    const back = await segment(g.id);
    expect((await post(mod, { action: 'remove', target: seg(back) })).res.status).toBe(200);
    expect(await db().liveSegment.count({ where: { id: g.id } })).toBe(0);
    expect(
      (await db().streamSession.findUniqueOrThrow({ where: { id: s.id } })).bookedMinutes,
    ).toBe(100);
  });

  it('ending a live: what was on screen happened, what never came up is skipped', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession({ inHours: 0, capacity: 300 });
    const add = async (title: string) =>
      segment(
        (
          (await post(mod, { action: 'event', sessionId: s.id, title, minutes: 60 })).json
            .segment as { id: string }
        ).id,
      );
    const on = await add('Bate-papo');
    const never = await add('Sorteio');
    expect(
      (
        await hit(startRoute, 'POST', '', {
          who: mod,
          params: { id: s.id },
          body: { expectedVersion: 0 },
        })
      ).res.status,
    ).toBe(200);
    expect((await post(mod, { action: 'now', target: seg(on) })).res.status).toBe(200);
    const fresh = await db().streamSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(
      (
        await hit(endRoute, 'POST', '', {
          who: mod,
          params: { id: s.id },
          body: { expectedVersion: fresh.version },
        })
      ).res.status,
    ).toBe(200);
    expect(await segment(on.id)).toMatchObject({ status: 'DONE' });
    expect(await segment(never.id)).toMatchObject({ status: 'SKIPPED' });
    expect(
      (await db().streamSession.findUniqueOrThrow({ where: { id: s.id } })).bookedMinutes,
    ).toBe(60);
    // Cronograma lists the event that happened, not the skipped one
    const days = await cronograma();
    const titles = days.flatMap((d) => d.sessions.flatMap((x) => x.titles.map((t) => t.title)));
    expect(titles).toContain('Bate-papo');
    expect(titles).not.toContain('Sorteio');
  });
});

describe('database rules', () => {
  it('a part needs a campaign, an event none; one segment playing per session; done ⇔ doneAt', async () => {
    const { campaign } = await series();
    const s = await makeSession();
    const base = { sessionId: s.id, label: 'X', minutes: 10 };
    await expect(db().liveSegment.create({ data: { ...base, kind: 'PART' } })).rejects.toThrow();
    await expect(
      db().liveSegment.create({ data: { ...base, kind: 'EVENT', campaignId: campaign.id } }),
    ).rejects.toThrow();
    await expect(
      db().liveSegment.create({
        data: { ...base, kind: 'EVENT', seasonNumber: 1, episodeFrom: 1, episodeTo: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      db().liveSegment.create({
        data: {
          ...base,
          kind: 'PART',
          campaignId: campaign.id,
          seasonNumber: 1,
          episodeFrom: 3,
          episodeTo: 2,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db().liveSegment.create({ data: { ...base, kind: 'EVENT', minutes: 0 } }),
    ).rejects.toThrow();
    await expect(
      db().liveSegment.create({ data: { ...base, kind: 'EVENT', status: 'DONE' } }),
    ).rejects.toThrow();
    await db().liveSegment.create({ data: { ...base, kind: 'EVENT', status: 'PLAYING' } });
    await expect(
      db().liveSegment.create({ data: { ...base, kind: 'EVENT', status: 'PLAYING' } }),
    ).rejects.toThrow();
  });
});
