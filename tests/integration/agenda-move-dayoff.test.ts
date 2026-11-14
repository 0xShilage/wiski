/**
 * Agenda QoL (2026-11-13): "Mover para outra live" (a movie, a whole campaign, a part or an event
 * straight from one session to another) and "Dias sem live" (Folga / Viagem with a note, on the
 * Cronograma).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { pgErrorCode, PG } from '@/server/db-errors';
import { cronograma } from '@/server/live/public';
import { todaySaoPaulo } from '@/server/releases/releases';
import { POST as scheduleRoute } from '@/app/api/v1/admin/schedule/route';
import { POST as reorderRoute } from '@/app/api/v1/admin/sessions/[id]/order/route';
import { GET as liveRoute } from '@/app/api/v1/admin/live/route';
import { POST as offRoute } from '@/app/api/v1/admin/days-off/route';
import { DELETE as offDeleteRoute } from '@/app/api/v1/admin/days-off/[id]/route';
import { clearCatalog } from '../support/catalog';
import {
  as,
  fundedCampaign,
  hit,
  makeSession,
  paidMovie,
  resetSlots,
  type Who,
} from '../support/live';

const day = (offset: number) =>
  new Date(todaySaoPaulo().getTime() + offset * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  await db().liveDayOff.deleteMany({});
  await clearCatalog();
  await db().streamSession.deleteMany({});
  resetSlots();
});
afterAll(async () => {
  await db().liveDayOff.deleteMany({});
});

const sched = (who: Who, body: unknown) =>
  hit(scheduleRoute, 'POST', '/api/v1/admin/schedule', { who, body });
const T = (kind: 'ORDER' | 'CAMPAIGN' | 'SEGMENT', id: string, expectedVersion: number) => ({
  kind,
  id,
  expectedVersion,
});
const session = (id: string) => db().streamSession.findUniqueOrThrow({ where: { id } });

describe('Mover para outra live', () => {
  it('moves a movie between lives: capacity follows, the hand order is forgotten, audited', async () => {
    const mod = await as('MODERATOR');
    const a = await makeSession({ inHours: 24, capacity: 300 });
    const b = await makeSession({ inHours: 72, capacity: 300 });
    const x = await paidMovie({ runtime: 120 });
    const y = await paidMovie({ runtime: 90 });
    await sched(mod, { action: 'add', target: T('ORDER', x.order.id, 0), sessionId: a.id });
    await sched(mod, { action: 'add', target: T('ORDER', y.order.id, 0), sessionId: a.id });
    const reorder = await hit(reorderRoute, 'POST', '', {
      who: mod,
      params: { id: a.id },
      body: { expectedVersion: 0, entries: [`ORDER:${y.order.id}`, `ORDER:${x.order.id}`] },
    });
    expect(reorder.res.status).toBe(200);

    const r = await sched(mod, {
      action: 'move',
      target: T('ORDER', x.order.id, 1),
      sessionId: b.id,
    });
    expect(r.res.status).toBe(200);
    const o = await db().order.findUniqueOrThrow({ where: { id: x.order.id } });
    expect(o).toMatchObject({
      status: 'SCHEDULED',
      sessionId: b.id,
      version: 2,
      rescheduleCount: 0,
    });
    const from = await session(a.id);
    expect(from.bookedMinutes).toBe(90);
    expect(from.entryOrder).toEqual([`ORDER:${y.order.id}`]);
    expect(from.version).toBe(2);
    expect((await session(b.id)).bookedMinutes).toBe(120);
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'schedule.move', targetId: x.order.id },
    });
    expect(log.metadata).toEqual({ from: a.id, to: b.id, kind: 'ORDER', minutes: 120 });
  });

  it('refuses a full target, the same session, a stale version and what already started', async () => {
    const mod = await as('MODERATOR');
    const a = await makeSession({ inHours: 1, capacity: 300 });
    const small = await makeSession({ inHours: 48, capacity: 60 });
    const b = await makeSession({ inHours: 72, capacity: 300 });
    const x = await paidMovie({ runtime: 120 });
    await sched(mod, { action: 'add', target: T('ORDER', x.order.id, 0), sessionId: a.id });

    const full = await sched(mod, {
      action: 'move',
      target: T('ORDER', x.order.id, 1),
      sessionId: small.id,
    });
    expect(full.res.status).toBe(409);
    expect(full.json.code).toBe('SESSION_FULL');
    expect((await session(a.id)).bookedMinutes).toBe(120); // rolled back
    expect((await session(small.id)).bookedMinutes).toBe(0);

    const same = await sched(mod, {
      action: 'move',
      target: T('ORDER', x.order.id, 1),
      sessionId: a.id,
    });
    expect(same.res.status).toBe(409);
    const stale = await sched(mod, {
      action: 'move',
      target: T('ORDER', x.order.id, 0),
      sessionId: b.id,
    });
    expect(stale.json.code).toBe('SCHEDULE_CHANGED');

    // on screen → stays put
    await db().streamSession.update({
      where: { id: a.id },
      data: { status: 'LIVE', startedAt: new Date() },
    });
    await sched(mod, { action: 'now', target: T('ORDER', x.order.id, 1) });
    const playing = await sched(mod, {
      action: 'move',
      target: T('ORDER', x.order.id, 2),
      sessionId: b.id,
    });
    expect(playing.res.status).toBe(409);
    expect(playing.json.code).toBe('INVALID_STATE');

    // a cancelled session is no target
    const gone = await db().streamSession.create({
      data: {
        startsAt: new Date(Date.now() + 96 * 3_600_000),
        capacityMinutes: 300,
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });
    const y = await paidMovie({ runtime: 60 });
    await sched(mod, { action: 'add', target: T('ORDER', y.order.id, 0), sessionId: b.id });
    const toCancelled = await sched(mod, {
      action: 'move',
      target: T('ORDER', y.order.id, 1),
      sessionId: gone.id,
    });
    expect(toCancelled.res.status).toBe(409);
  });

  it('moves a whole campaign and a part of a series, with the minutes of the part', async () => {
    const mod = await as('MODERATOR');
    const a = await makeSession({ inHours: 24, capacity: 300 });
    const b = await makeSession({ inHours: 72, capacity: 300 });
    const whole = await fundedCampaign('FRANCHISE');
    await sched(mod, {
      action: 'add',
      target: T('CAMPAIGN', whole.campaign.id, 0),
      sessionId: a.id,
    });
    const c = await sched(mod, {
      action: 'move',
      target: T('CAMPAIGN', whole.campaign.id, 1),
      sessionId: b.id,
    });
    expect(c.res.status).toBe(200);
    expect(
      await db().campaign.findUniqueOrThrow({ where: { id: whole.campaign.id } }),
    ).toMatchObject({ status: 'SCHEDULED', sessionId: b.id });

    const s = await fundedCampaign('SERIES');
    await db().catalogItem.update({
      where: { id: s.item.id },
      data: { seasonCount: 2, episodeCount: 20 },
    });
    const part = await sched(mod, {
      action: 'part',
      campaignId: s.campaign.id,
      sessionId: a.id,
      season: 1,
      episodeFrom: 1,
      episodeTo: 3,
      minutes: 135,
    });
    const segId = (part.json.segment as { id: string }).id;
    expect((await session(a.id)).bookedMinutes).toBe(135);
    const m = await sched(mod, { action: 'move', target: T('SEGMENT', segId, 0), sessionId: b.id });
    expect(m.res.status).toBe(200);
    expect(await db().liveSegment.findUniqueOrThrow({ where: { id: segId } })).toMatchObject({
      sessionId: b.id,
      status: 'SCHEDULED',
      version: 1,
    });
    expect((await session(a.id)).bookedMinutes).toBe(0);
    expect((await session(b.id)).bookedMinutes).toBe(135);
  });
});

describe('Dias sem live', () => {
  it('a moderator marks a trip and a day off; both show on the Cronograma with the note', async () => {
    const mod = await as('MODERATOR');
    const trip = await hit(offRoute, 'POST', '', {
      who: mod,
      body: { startsOn: day(3), endsOn: day(6), reason: 'VIAGEM', note: '  Volto com maratona! ' },
    });
    expect(trip.res.status).toBe(201);
    expect(trip.json).toMatchObject({
      startsOn: day(3),
      endsOn: day(6),
      reason: 'VIAGEM',
      note: 'Volto com maratona!',
    });
    const folga = await hit(offRoute, 'POST', '', {
      who: mod,
      body: { startsOn: day(1), reason: 'FOLGA' },
    });
    expect(folga.res.status).toBe(201);
    expect(folga.json).toMatchObject({ startsOn: day(1), endsOn: day(1), note: null });
    const planned = await makeSession({ inHours: 24 * 9, capacity: 300 });

    const days = await cronograma();
    const offs = days.flatMap((d) => d.offs.map((o) => [d.date, o.reason]));
    expect(offs).toEqual([
      [day(1), 'FOLGA'],
      [day(3), 'VIAGEM'],
    ]);
    // days stay in order, sessions included
    const dates = days.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
    expect(days.some((d) => d.sessions.some((s) => s.id === planned.id))).toBe(true);

    const admin = await hit(liveRoute, 'GET', '/api/v1/admin/live', { who: mod });
    expect((admin.json.daysOff as { reason: string }[]).map((o) => o.reason)).toEqual([
      'FOLGA',
      'VIAGEM',
    ]);

    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'dayoff.create', targetId: (trip.json as { id: string }).id },
    });
    expect(log.metadata).toEqual({ reason: 'VIAGEM', days: 4, note: true });

    // the live is back on the day off
    const id = (folga.json as { id: string }).id;
    const del = await hit(offDeleteRoute, 'DELETE', '', { who: mod, params: { id } });
    expect(del.res.status).toBe(204);
    expect(await db().liveDayOff.count()).toBe(1);
    expect(
      await db().auditLog.findFirst({ where: { action: 'dayoff.delete', targetId: id } }),
    ).not.toBeNull();
  });

  it('a stretch that started yesterday shows today; past and overlapping ones are refused', async () => {
    const mod = await as('MODERATOR');
    const started = await db().liveDayOff.create({
      data: {
        startsOn: new Date(`${day(-1)}T00:00:00Z`),
        endsOn: new Date(`${day(2)}T00:00:00Z`),
        reason: 'FOLGA',
        createdById: mod.user.id,
      },
    });
    const days = await cronograma();
    expect(days.find((d) => d.offs.some((o) => o.id === started.id))?.date).toBe(day(0));

    const overlap = await hit(offRoute, 'POST', '', {
      who: mod,
      body: { startsOn: day(2), endsOn: day(4), reason: 'VIAGEM' },
    });
    expect(overlap.res.status).toBe(409);
    expect(overlap.json.code).toBe('DAY_OFF_OVERLAP');

    const past = await hit(offRoute, 'POST', '', {
      who: mod,
      body: { startsOn: day(-5), endsOn: day(-3), reason: 'FOLGA' },
    });
    expect(past.res.status).toBe(422);
    const backwards = await hit(offRoute, 'POST', '', {
      who: mod,
      body: { startsOn: day(9), endsOn: day(8), reason: 'FOLGA' },
    });
    expect(backwards.res.status).toBe(422);
    const long = await hit(offRoute, 'POST', '', {
      who: mod,
      body: { startsOn: day(10), endsOn: day(41), reason: 'VIAGEM' },
    });
    expect(long.res.status).toBe(422);
    const note = await hit(offRoute, 'POST', '', {
      who: mod,
      body: { startsOn: day(10), reason: 'OUTRO', note: 'x'.repeat(141) },
    });
    expect(note.res.status).toBe(422);
    const viewer = await as('USER');
    const nope = await hit(offRoute, 'POST', '', {
      who: viewer,
      body: { startsOn: day(10), reason: 'FOLGA' },
    });
    expect(nope.res.status).toBe(404); // admin routes don't exist for viewers
  });

  it('the database keeps stretches short, ordered and apart', async () => {
    const mod = await as('MODERATOR');
    const at = (d: string) => new Date(`${d}T00:00:00Z`);
    const make = (startsOn: string, endsOn: string, note: string | null = null) =>
      db().liveDayOff.create({
        data: {
          startsOn: at(startsOn),
          endsOn: at(endsOn),
          reason: 'FOLGA',
          note,
          createdById: mod.user.id,
        },
      });
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
        return null;
      } catch (err) {
        return pgErrorCode(err);
      }
    };
    await make(day(20), day(22));
    expect(await code(make(day(22), day(23)))).toBe(PG.exclusionViolation);
    expect(await code(make(day(30), day(29)))).toBe(PG.checkViolation);
    expect(await code(make(day(30), day(61)))).toBe(PG.checkViolation);
    expect(await code(make(day(30), day(30), ''))).toBe(PG.checkViolation);
    expect(await code(make(day(23), day(23)))).toBeNull(); // the next day is fine
  });
});
