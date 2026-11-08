/**
 * The live schedule (Phase 4): sessions, the queue, capacity under concurrency, one live session,
 * "Agora assistindo" / "Concluído" (→ watched, reviews open), ending and cancelling a session,
 * the owner's reschedule rules (04 §7), and the public "Próximos na live".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { POST as createSessionRoute } from '@/app/api/v1/admin/sessions/route';
import { PATCH as updateSessionRoute } from '@/app/api/v1/admin/sessions/[id]/route';
import { POST as startRoute } from '@/app/api/v1/admin/sessions/[id]/start/route';
import { POST as endRoute } from '@/app/api/v1/admin/sessions/[id]/end/route';
import { POST as cancelRoute } from '@/app/api/v1/admin/sessions/[id]/cancel/route';
import { POST as scheduleRoute } from '@/app/api/v1/admin/schedule/route';
import { GET as liveRoute } from '@/app/api/v1/admin/live/route';
import { GET as publicRoute } from '@/app/api/v1/sessions/route';
import {
  GET as optionsRoute,
  POST as rescheduleRoute,
} from '@/app/api/v1/orders/[code]/reschedule/route';
import { POST as watchedRoute } from '@/app/api/v1/admin/catalog/items/[id]/watched/route';
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
import { postReview } from '../support/reviews';
import { cronograma } from '@/server/live/public';

beforeEach(async () => {
  vi.stubGlobal('fetch', async () => Response.json({ success: true })); // Turnstile (reviews)
  await clearCatalog();
  await db().streamSession.deleteMany({});
  resetSlots();
});

const sched = (who: Who, body: unknown) =>
  hit(scheduleRoute, 'POST', '/api/v1/admin/schedule', { who, body });
const order = (id: string) => db().order.findUniqueOrThrow({ where: { id } });
const session = (id: string) => db().streamSession.findUniqueOrThrow({ where: { id } });
const T = (kind: 'ORDER' | 'CAMPAIGN', id: string, expectedVersion: number) => ({
  kind,
  id,
  expectedVersion,
});

describe('sessions', () => {
  it('a moderator plans, edits and starts a session; one live at a time; audited', async () => {
    const mod = await as('MODERATOR');
    const startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const c = await hit(createSessionRoute, 'POST', '/api/v1/admin/sessions', {
      who: mod,
      body: {
        startsAt,
        capacityMinutes: 240,
        publicNote: `  Sexta de terror${String.fromCodePoint(0x202e)}  `,
      },
    });
    expect(c.res.status).toBe(201);
    const s = c.json.session as { id: string; publicNote: string; version: number };
    expect(s.publicNote).toBe('Sexta de terror');

    const u = await hit(updateSessionRoute, 'PATCH', `/api/v1/admin/sessions/${s.id}`, {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: 0, capacityMinutes: 300 },
    });
    expect((u.json.session as { capacityMinutes: number }).capacityMinutes).toBe(300);
    const stale = await hit(updateSessionRoute, 'PATCH', `/api/v1/admin/sessions/${s.id}`, {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: 0, capacityMinutes: 200 },
    });
    expect([stale.res.status, stale.json.code]).toEqual([409, 'SCHEDULE_CHANGED']);

    const other = await makeSession();
    const st = await hit(startRoute, 'POST', '', {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: 1 },
    });
    expect((st.json.session as { status: string }).status).toBe('LIVE');
    const second = await hit(startRoute, 'POST', '', {
      who: mod,
      params: { id: other.id },
      body: { expectedVersion: 0 },
    });
    expect([second.res.status, second.json.code]).toEqual([409, 'ANOTHER_SESSION_LIVE']);
    expect(
      await db().auditLog.count({ where: { targetId: s.id, action: { startsWith: 'session.' } } }),
    ).toBe(3);
  });

  it('two sessions started at the same moment → exactly one goes live', async () => {
    const mod = await as('MODERATOR');
    const a = await makeSession();
    const b = await makeSession();
    const r = await Promise.all([
      hit(startRoute, 'POST', '', { who: mod, params: { id: a.id }, body: { expectedVersion: 0 } }),
      hit(startRoute, 'POST', '', { who: mod, params: { id: b.id }, body: { expectedVersion: 0 } }),
    ]);
    expect(r.map((x) => x.res.status).sort()).toEqual([200, 409]);
    expect(await db().streamSession.count({ where: { status: 'LIVE' } })).toBe(1);
  });

  it('capacity can never drop below what is booked; note length after sanitising', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession({ capacity: 240 });
    const { order: o } = await paidMovie({ runtime: 200 });
    await sched(mod, { action: 'add', target: T('ORDER', o.id, 0), sessionId: s.id });
    const r = await hit(updateSessionRoute, 'PATCH', '', {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: 0, capacityMinutes: 150 },
    });
    expect([r.res.status, r.json.code]).toEqual([409, 'CAPACITY_BELOW_BOOKED']);
    const n = await hit(updateSessionRoute, 'PATCH', '', {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: 0, publicNote: 'x'.repeat(141) },
    });
    expect(n.res.status).toBe(422);
  });

  it('cancel (moderators too, since 2026-11-08) sends everything back to the queue and frees the capacity', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession();
    const { order: o } = await paidMovie({ runtime: 120 });
    const { campaign } = await fundedCampaign();
    await sched(mod, { action: 'add', target: T('ORDER', o.id, 0), sessionId: s.id });
    await sched(mod, { action: 'add', target: T('CAMPAIGN', campaign.id, 0), sessionId: s.id });
    expect((await session(s.id)).bookedMinutes).toBe(120);
    const r = await hit(cancelRoute, 'POST', '', {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: 0 },
    });
    expect((r.json.session as { status: string }).status).toBe('CANCELLED');
    expect(await order(o.id)).toMatchObject({ status: 'PAID', sessionId: null, scheduledAt: null });
    expect(await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({
      status: 'FUNDED',
      sessionId: null,
    });
    expect((await session(s.id)).bookedMinutes).toBe(0);
  });
});

describe('the queue and scheduling', () => {
  it('"Topo da fila" first, then "Prioridade", then by payment time; campaigns too', async () => {
    const t0 = Date.now() - 3_600_000;
    const a = await paidMovie({ paidAt: new Date(t0) });
    const b = await paidMovie({ paidAt: new Date(t0 + 1000), tier: 'prioridade' });
    const c = await paidMovie({ paidAt: new Date(t0 + 2000), tier: 'topo' });
    const d = await paidMovie({ paidAt: new Date(t0 - 1000) });
    const camp = await fundedCampaign();
    const r = await hit(liveRoute, 'GET', '/api/v1/admin/live', { who: await as('MODERATOR') });
    const q = r.json.queue as { id: string }[];
    expect(q.map((e) => e.id).slice(0, 4)).toEqual([
      c.order.id,
      b.order.id,
      d.order.id,
      a.order.id,
    ]);
    expect(q.map((e) => e.id)).toContain(camp.campaign.id);
  });

  it('10 movies of 120 min racing for a 300-min session → exactly 2 fit', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession({ capacity: 300 });
    const movies = [];
    for (let i = 0; i < 10; i++) movies.push(await paidMovie({ runtime: 120 }));
    const r = await Promise.all(
      movies.map((m) =>
        sched(mod, { action: 'add', target: T('ORDER', m.order.id, 0), sessionId: s.id }),
      ),
    );
    expect(r.filter((x) => x.res.status === 200)).toHaveLength(2);
    expect(r.filter((x) => x.json.code === 'SESSION_FULL')).toHaveLength(8);
    expect((await session(s.id)).bookedMinutes).toBe(240);
    expect(await db().order.count({ where: { sessionId: s.id, status: 'SCHEDULED' } })).toBe(2);
  });

  it('a stale version, a session that is over, or the wrong state answer 409', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession();
    const { order: o } = await paidMovie();
    expect(
      (await sched(mod, { action: 'add', target: T('ORDER', o.id, 5), sessionId: s.id })).json.code,
    ).toBe('SCHEDULE_CHANGED');
    await db().streamSession.update({
      where: { id: s.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    expect(
      (await sched(mod, { action: 'add', target: T('ORDER', o.id, 0), sessionId: s.id })).json.code,
    ).toBe('INVALID_STATE');
    const open = await makeSession();
    const nope = await sched(mod, {
      action: 'add',
      target: T('ORDER', '00000000-0000-7000-8000-000000000000', 0),
      sessionId: open.id,
    });
    expect(nope.res.status).toBe(404);
  });

  it('remove puts a movie back in the queue and frees its minutes', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession();
    const { order: o } = await paidMovie({ runtime: 90 });
    await sched(mod, { action: 'add', target: T('ORDER', o.id, 0), sessionId: s.id });
    const r = await sched(mod, { action: 'remove', target: T('ORDER', o.id, 1) });
    expect(r.res.status).toBe(200);
    expect(await order(o.id)).toMatchObject({ status: 'PAID', sessionId: null });
    expect((await session(s.id)).bookedMinutes).toBe(0);
  });
});

describe('on air', () => {
  it('now playing → completed: order COMPLETED, item WATCHED, watch event with order + session, reviews open', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession({ status: 'LIVE' });
    const a = await paidMovie();
    const b = await paidMovie();
    await sched(mod, { action: 'add', target: T('ORDER', a.order.id, 0), sessionId: s.id });
    await sched(mod, { action: 'add', target: T('ORDER', b.order.id, 0), sessionId: s.id });

    await sched(mod, { action: 'now', target: T('ORDER', a.order.id, 1) });
    expect((await order(a.order.id)).status).toBe('WATCHING');
    expect((await session(s.id)).nowItemId).toBe(a.item.id);
    // switching to b puts a back to SCHEDULED
    await sched(mod, { action: 'now', target: T('ORDER', b.order.id, 1) });
    expect((await order(a.order.id)).status).toBe('SCHEDULED');
    expect((await order(b.order.id)).status).toBe('WATCHING');

    const done = await sched(mod, { action: 'complete', target: T('ORDER', b.order.id, 2) });
    expect(done.res.status).toBe(200);
    expect(await order(b.order.id)).toMatchObject({ status: 'COMPLETED' });
    expect((await order(b.order.id)).completedAt).not.toBeNull();
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: b.item.id } })).status).toBe(
      'WATCHED',
    );
    expect(await db().watchEvent.findFirstOrThrow({ where: { itemId: b.item.id } })).toMatchObject({
      orderId: b.order.id,
      sessionId: s.id,
    });
    expect((await session(s.id)).nowItemId).toBeNull();
    const fan = await as('USER');
    expect((await postReview(fan, b.item.id)).res.status).toBe(201);
  });

  it('completing needs the session live; ending needs nothing playing and returns the rest', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession();
    const { order: o } = await paidMovie({ runtime: 100 });
    const { campaign } = await fundedCampaign();
    await sched(mod, { action: 'add', target: T('ORDER', o.id, 0), sessionId: s.id });
    await sched(mod, { action: 'add', target: T('CAMPAIGN', campaign.id, 0), sessionId: s.id });
    expect((await sched(mod, { action: 'complete', target: T('ORDER', o.id, 1) })).json.code).toBe(
      'INVALID_STATE',
    );

    await hit(startRoute, 'POST', '', {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: 0 },
    });
    await sched(mod, { action: 'now', target: T('ORDER', o.id, 1) });
    const blocked = await hit(endRoute, 'POST', '', {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: 2 },
    });
    expect([blocked.res.status, blocked.json.code]).toEqual([409, 'INVALID_STATE']);
    await sched(mod, { action: 'complete', target: T('CAMPAIGN', campaign.id, 1) });
    expect((await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      'WATCHED',
    );
    // put the movie back to scheduled by choosing nothing else: complete it? no — unschedule is not allowed while watching
    await db().order.update({
      where: { id: o.id },
      data: { status: 'SCHEDULED', version: { increment: 1 } },
    });
    await db().streamSession.update({ where: { id: s.id }, data: { nowItemId: null } });
    const v = (await session(s.id)).version;
    const ended = await hit(endRoute, 'POST', '', {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: v },
    });
    expect((ended.json.session as { status: string }).status).toBe('DONE');
    expect(await order(o.id)).toMatchObject({ status: 'PAID', sessionId: null });
    expect((await session(s.id)).bookedMinutes).toBe(0);
  });

  it('the dashboard\'s "Marcar como assistido" also completes the movie order', async () => {
    const mod = await as('MODERATOR');
    const { item, order: o } = await paidMovie();
    const r = await hit(watchedRoute, 'POST', '', { who: mod, params: { id: item.id } });
    expect(r.res.status).toBe(200);
    expect(await order(o.id)).toMatchObject({ status: 'COMPLETED' });
    expect((await db().watchEvent.findFirstOrThrow({ where: { itemId: item.id } })).orderId).toBe(
      o.id,
    );
  });
});

describe('the buyer moves their date (04 §7)', () => {
  async function scheduledFor(user: Who['user'], inHours: number) {
    const mod = await as('MODERATOR');
    const s = await makeSession({ inHours });
    const m = await paidMovie({ user, runtime: 100 });
    await sched(mod, { action: 'add', target: T('ORDER', m.order.id, 0), sessionId: s.id });
    return { session: s, ...m };
  }

  it('owner only, ≥ 24 h before, PLANNED target within 60 days with room, at most twice', async () => {
    const owner = await as('USER');
    const { session: s, order: o } = await scheduledFor(owner.user, 72);
    const t1 = await makeSession({ inHours: 96 });
    const t2 = await makeSession({ inHours: 120 });
    const t3 = await makeSession({ inHours: 144 });
    const far = await makeSession({ inHours: 24 * 70 });
    const soon = await makeSession({ inHours: 10 });
    const small = await makeSession({ inHours: 100, capacity: 60 });
    const code = o.publicCode;
    const go = (who: Who, sessionId: string) =>
      hit(rescheduleRoute, 'POST', `/api/v1/orders/${code}/reschedule`, {
        who,
        params: { code },
        body: { sessionId },
      });

    const opts = await hit(optionsRoute, 'GET', `/api/v1/orders/${code}/reschedule`, {
      who: owner,
      params: { code },
    });
    const ids = (opts.json.sessions as { id: string }[]).map((x) => x.id);
    expect(ids).toEqual([t1.id, t2.id, t3.id]);
    expect(ids).not.toContain(far.id);
    expect(ids).not.toContain(soon.id);
    expect(ids).not.toContain(small.id);

    expect((await go(await as('USER'), t1.id)).res.status).toBe(404);
    expect((await go(owner, far.id)).json.code).toBe('RESCHEDULE_NOT_ALLOWED');
    expect((await go(owner, small.id)).json.code).toBe('SESSION_FULL');
    expect((await go(owner, t1.id)).res.status).toBe(200);
    expect((await session(s.id)).bookedMinutes).toBe(0);
    expect((await session(t1.id)).bookedMinutes).toBe(100);
    expect((await go(owner, t2.id)).res.status).toBe(200);
    const third = await go(owner, t3.id);
    expect([third.res.status, third.json.code]).toEqual([409, 'RESCHEDULE_NOT_ALLOWED']);
    expect((await order(o.id)).rescheduleCount).toBe(2);
    expect(
      await db().auditLog.count({ where: { action: 'order.reschedule', targetId: o.id } }),
    ).toBe(2);
  });

  it('closed within 24 h of the current session', async () => {
    const owner = await as('USER');
    const { order: o } = await scheduledFor(owner.user, 20);
    const t = await makeSession({ inHours: 96 });
    const r = await hit(rescheduleRoute, 'POST', '', {
      who: owner,
      params: { code: o.publicCode },
      body: { sessionId: t.id },
    });
    expect([r.res.status, r.json.code]).toEqual([409, 'RESCHEDULE_NOT_ALLOWED']);
  });
});

describe('public schedule', () => {
  it('upcoming sessions with titles and approved names only — never e-mails', async () => {
    const mod = await as('MODERATOR');
    const s = await makeSession({ inHours: 30 });
    const fan = await as('USER');
    const named = await paidMovie({ user: fan.user, title: 'Filme do Fã' });
    const guest = await paidMovie({ guestName: 'Nome Pendente', title: 'Filme do Convidado' });
    await sched(mod, { action: 'add', target: T('ORDER', named.order.id, 0), sessionId: s.id });
    await sched(mod, { action: 'add', target: T('ORDER', guest.order.id, 0), sessionId: s.id });
    const r = await hit(publicRoute, 'GET', '/api/v1/sessions');
    const sessions = r.json.sessions as {
      id: string;
      titles: { title: string; sponsor: string | null }[];
    }[];
    const mine = sessions.find((x) => x.id === s.id)!;
    expect(mine.titles).toContainEqual(
      expect.objectContaining({ title: 'Filme do Fã', sponsor: `@${fan.user.username}` }),
    );
    expect(mine.titles).toContainEqual(
      expect.objectContaining({ title: 'Filme do Convidado', sponsor: null }),
    );
    expect(JSON.stringify(r.json)).not.toMatch(/@example\.com|Nome Pendente/);
  });
});

describe('cronograma', () => {
  it('booked titles of upcoming lives by day, watched titles of the last two days, nothing unbooked', async () => {
    const mod = await as('MODERATOR');
    // a live that is on now: one title watched, one left over (goes back to the queue at the end)
    const past = await db().streamSession.create({
      data: {
        startsAt: new Date(Date.now() - 3 * 3_600_000),
        capacityMinutes: 300,
        status: 'LIVE',
        startedAt: new Date(Date.now() - 3 * 3_600_000),
      },
    });
    const watched = await paidMovie({ title: 'Já Assistido' });
    const leftover = await paidMovie({ title: 'Sobrou da Live' });
    await sched(mod, {
      action: 'add',
      target: T('ORDER', watched.order.id, 0),
      sessionId: past.id,
    });
    await sched(mod, {
      action: 'add',
      target: T('ORDER', leftover.order.id, 0),
      sessionId: past.id,
    });
    await sched(mod, { action: 'complete', target: T('ORDER', watched.order.id, 1) });
    const v = (await session(past.id)).version;
    await hit(endRoute, 'POST', '', {
      who: mod,
      params: { id: past.id },
      body: { expectedVersion: v },
    });

    // upcoming: a movie and a funded series booked; a paid movie with no date is not listed
    const next = await makeSession({ inHours: 30 });
    const booked = await paidMovie({ title: 'Marcado Para Amanhã' });
    const { campaign, item: series } = await fundedCampaign();
    await sched(mod, { action: 'add', target: T('ORDER', booked.order.id, 0), sessionId: next.id });
    await sched(mod, { action: 'add', target: T('CAMPAIGN', campaign.id, 0), sessionId: next.id });
    await paidMovie({ title: 'Pago Sem Data' });
    const empty = await makeSession({ inHours: 80 });

    const days = await cronograma();
    const all = days.flatMap((d) => d.sessions);
    const titles = all.flatMap((s) => s.titles.map((t) => t.title));
    expect(titles).toContain('Já Assistido');
    expect(titles).toContain('Marcado Para Amanhã');
    expect(titles).toContain(series.title);
    expect(titles).not.toContain('Sobrou da Live');
    expect(titles).not.toContain('Pago Sem Data');
    expect(all.find((s) => s.id === past.id)).toMatchObject({ past: true });
    expect(all.find((s) => s.id === next.id)).toMatchObject({ past: false });
    expect(all.find((s) => s.id === empty.id)?.titles).toEqual([]);
    // grouped by São Paulo calendar day, in order
    const keys = days.map((d) => d.date);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of days) expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // three days later the finished live is gone
    const later = await cronograma(new Date(Date.now() + 3 * 86_400_000));
    expect(later.flatMap((d) => d.sessions).some((s) => s.id === past.id)).toBe(false);
  });
});
