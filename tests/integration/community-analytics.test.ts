/**
 * 2026-11-04: badges (only named, paid, not-refunded sponsorships; reviews and likes), the opt-out
 * switch, /ranking (who is and isn't ranked, month vs all time), a title's place in the queue
 * (waiting, booked on a live with an estimate, playing now) and Admin › Análise (what counts as
 * revenue, the split, the series, the top titles, the Pix conversion).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { analytics } from '@/server/admin/analytics';
import { achievementsFor } from '@/server/community/achievements';
import { ranking } from '@/server/community/rankings';
import { titleQueueStatus } from '@/server/live/position';
import { findProfile } from '@/server/reviews/read';
import { exportMyData } from '@/server/users/lgpd';
import { PATCH as profileRoute } from '@/app/api/v1/me/profile/route';
import { POST as scheduleRoute } from '@/app/api/v1/admin/schedule/route';
import { POST as startRoute } from '@/app/api/v1/admin/sessions/[id]/start/route';
import { clearCatalog, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { freshIp } from '../support/http';
import { as, fundedCampaign, hit, makeSession, paidMovie, resetSlots } from '../support/live';
import { testPublicCode } from '../support/orders';
import { watchedItem } from '../support/reviews';

const DAY = 86_400_000;

beforeEach(async () => {
  await clearCatalog();
  await db().streamSession.deleteMany({});
  await db().roletaSpin.deleteMany({});
  resetSlots();
});

/** a visible review on a watched title, with `likes` likes from other accounts */
async function review(user: User, likes = 0, createdAt = new Date()) {
  const item = await watchedItem();
  const r = await db().review.create({
    data: { userId: user.id, itemId: item.id, rating: 5, body: 'Que filme bom!', createdAt },
  });
  for (let i = 0; i < likes; i++) {
    const fan = await makeUser();
    await db().reviewLike.create({ data: { userId: fan.id, reviewId: r.id } });
  }
  return r;
}

async function contribution(user: User, showSponsorName = true) {
  const { item, campaign } = await fundedCampaign();
  return db().order.create({
    data: {
      publicCode: testPublicCode(),
      kind: 'CONTRIBUTION',
      itemId: item.id,
      campaignId: campaign.id,
      userId: user.id,
      contactEmail: user.email,
      buyerKey: `u:${user.id}`,
      accessTokenHash: randomBytes(32),
      breakdown: [],
      subtotalCents: 1000,
      totalCents: 1000,
      status: 'PAID',
      paidAt: new Date(),
      showSponsorName,
      clientRequestId: randomUUID(),
    },
  });
}

describe('badges', () => {
  it('count named, paid sponsorships and contributions, visible reviews and their likes — never anonymous or refunded ones', async () => {
    const u = await makeUser();
    await paidMovie({ user: u });
    const anon = await paidMovie({ user: u });
    await db().order.update({ where: { id: anon.order.id }, data: { showSponsorName: false } });
    const refunded = await paidMovie({ user: u });
    await db().order.update({ where: { id: refunded.order.id }, data: { status: 'REFUNDED' } });
    await contribution(u);
    await contribution(u, false);
    await review(u, 3);
    const hidden = await review(u, 0);
    await db().review.update({ where: { id: hidden.id }, data: { status: 'HIDDEN' } });

    const fresh = await db().user.findUniqueOrThrow({ where: { id: u.id } });
    const badges = Object.fromEntries((await achievementsFor(fresh)).map((b) => [b.id, b]));
    expect(badges['sponsor-1']).toMatchObject({ earned: true, value: 1 });
    expect(badges['sponsor-5']).toMatchObject({ earned: false, value: 1 });
    expect(badges['backer-1']).toMatchObject({ earned: true, value: 1 });
    expect(badges['review-1']).toMatchObject({ earned: true, value: 1 });
    expect(badges['likes-10']).toMatchObject({ earned: false, value: 3 });
    expect(badges.vip!.earned).toBe(false);
  });

  it('the viewer can hide them: the switch is saved, audited, exported and read by the public profile', async () => {
    const v = await as('USER');
    const off = await hit(profileRoute, 'PATCH', '/api/v1/me/profile', {
      who: v,
      body: { showAchievements: false },
      ip: freshIp(),
    });
    expect(off.res.status).toBe(200);
    expect((await findProfile(v.user.username!))?.showAchievements).toBe(false);
    const a = await db().auditLog.findFirst({
      where: { action: 'user.achievements.visibility', targetId: v.user.id },
      orderBy: { id: 'desc' },
    });
    expect(a?.metadata).toEqual({ show: false });
    const me = await db().user.findUniqueOrThrow({ where: { id: v.user.id } });
    expect((await exportMyData(me, null)).account.showAchievements).toBe(false);
    // an empty body is still refused
    const none = await hit(profileRoute, 'PATCH', '/api/v1/me/profile', {
      who: v,
      body: {},
      ip: freshIp(),
    });
    expect(none.res.status).toBe(422);
  });
});

describe('ranking', () => {
  it('counts only; the opted-out, the suspended and the streamer are not ranked; ties share a place', async () => {
    const a = await makeUser({ username: 'rank_a' });
    const b = await makeUser({ username: 'rank_b' });
    const c = await makeUser({ username: 'rank_c' });
    const out = await makeUser({ username: 'rank_out' });
    const sus = await makeUser({ username: 'rank_sus', status: 'SUSPENDED' });
    const st = await makeUser({ username: 'rank_st', role: 'STREAMER' });
    await db().user.update({ where: { id: out.id }, data: { showAchievements: false } });
    for (const [u, n] of [
      [a, 3],
      [b, 2],
      [c, 2],
      [out, 5],
      [sus, 5],
      [st, 6],
    ] as const) {
      for (let i = 0; i < n; i++) await paidMovie({ user: u });
    }
    const anon = await paidMovie({ user: c });
    await db().order.update({ where: { id: anon.order.id }, data: { showSponsorName: false } });

    const rows = await ranking('patrocinadores', 'geral');
    expect(rows.map((r) => [r.position, r.username, r.value])).toEqual([
      [1, 'rank_a', 3],
      [2, 'rank_b', 2],
      [2, 'rank_c', 2],
    ]);
    expect(rows[0]).not.toHaveProperty('cents');
  });

  it('"este mês" vs "desde sempre"; critics by reviews; likes by likes received', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 70 * DAY);
    const a = await makeUser({ username: 'mes_a' });
    const b = await makeUser({ username: 'mes_b' });
    await paidMovie({ user: a, paidAt: old });
    await paidMovie({ user: a, paidAt: old });
    await paidMovie({ user: b });
    expect((await ranking('patrocinadores', 'mes', now)).map((r) => r.username)).toEqual(['mes_b']);
    expect((await ranking('patrocinadores', 'geral', now)).map((r) => r.username)).toEqual([
      'mes_a',
      'mes_b',
    ]);

    await review(a, 1, old);
    await review(b, 4);
    await review(b, 0);
    expect((await ranking('criticos', 'mes', now)).map((r) => [r.username, r.value])).toEqual([
      ['mes_b', 2],
    ]);
    expect((await ranking('criticos', 'geral', now)).map((r) => [r.username, r.value])).toEqual([
      ['mes_b', 2],
      ['mes_a', 1],
    ]);
    expect((await ranking('curtidas', 'geral', now)).map((r) => [r.username, r.value])).toEqual([
      ['mes_b', 4],
      ['mes_a', 1],
    ]);
  });
});

describe('a title’s place in the queue', () => {
  it('waiting → booked on a live with an estimate → playing now', async () => {
    const mod = await as('MODERATOR');
    const first = await paidMovie({ runtime: 95, paidAt: new Date(Date.now() - 2 * 3_600_000) });
    const second = await paidMovie({ runtime: 110, paidAt: new Date(Date.now() - 3_600_000) });
    const s = await makeSession({ inHours: 48, capacity: 400 });

    const waiting = await titleQueueStatus(second.item);
    expect(waiting).toEqual({
      kind: 'queued',
      position: 2,
      total: 2,
      nextLiveAt: s.startsAt.toISOString(),
    });

    const sched = (id: string) =>
      hit(scheduleRoute, 'POST', '/api/v1/admin/schedule', {
        who: mod,
        body: { action: 'add', target: { kind: 'ORDER', id, expectedVersion: 0 }, sessionId: s.id },
      });
    expect((await sched(first.order.id)).res.status).toBe(200);
    expect((await sched(second.order.id)).res.status).toBe(200);
    const booked = await titleQueueStatus(second.item);
    expect(booked).toEqual({
      kind: 'scheduled',
      sessionStartsAt: s.startsAt.toISOString(),
      live: false,
      position: 2,
      total: 2,
      estimatedAt: new Date(s.startsAt.getTime() + 95 * 60_000).toISOString(),
    });

    // the live starts and the second title goes on screen
    const started = await hit(startRoute, 'POST', '', {
      who: mod,
      params: { id: s.id },
      body: { expectedVersion: 0 },
    });
    expect(started.res.status).toBe(200);
    const fresh = await db().order.findUniqueOrThrow({ where: { id: second.order.id } });
    const now = await hit(scheduleRoute, 'POST', '/api/v1/admin/schedule', {
      who: mod,
      body: {
        action: 'now',
        target: { kind: 'ORDER', id: second.order.id, expectedVersion: fresh.version },
      },
    });
    expect(now.res.status).toBe(200);
    expect(await titleQueueStatus(second.item)).toEqual({ kind: 'playing' });
  });

  it('a funded series waits in the same queue; an unsponsored title has no card', async () => {
    const { item } = await fundedCampaign();
    expect(await titleQueueStatus(item)).toMatchObject({ kind: 'queued', position: 1, total: 1 });
    const free = await makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot: 1 });
    expect(await titleQueueStatus(free)).toBeNull();
  });
});

describe('Admin › Análise', () => {
  it('revenue = paid, not refunded orders by payment day; Pix vs "Já pago"; series, top titles, conversion', async () => {
    const now = new Date();
    const a = await paidMovie({ title: 'Mais pago', paidAt: new Date(now.getTime() - 2 * DAY) });
    await db().order.update({
      where: { id: a.order.id },
      data: { subtotalCents: 5000, totalCents: 5000 },
    });
    const manual = await paidMovie({ title: 'Já pago', paidAt: new Date(now.getTime() - DAY) });
    await db().order.update({ where: { id: manual.order.id }, data: { source: 'MANUAL' } });
    const refunded = await paidMovie({ title: 'Reembolsado' });
    await db().order.update({ where: { id: refunded.order.id }, data: { status: 'REFUNDED' } });
    const pending = await paidMovie({ title: 'Pendente' });
    await db().order.update({
      where: { id: pending.order.id },
      data: { status: 'PENDING_PAYMENT', paidAt: null },
    });
    const before = await paidMovie({
      title: 'Mês passado',
      paidAt: new Date(now.getTime() - 40 * DAY),
    });
    await db().order.update({
      where: { id: before.order.id },
      data: { subtotalCents: 2500, totalCents: 2500 },
    });

    // rows were just created: read the period up to this moment
    const v = await analytics(30, new Date());
    expect(v.revenue).toMatchObject({
      cents: 7000,
      checkoutCents: 5000,
      manualCents: 2000,
      orders: 2,
      averageCents: 3500,
      movies: 2,
      contributions: 0,
      previousCents: 2500,
      change: 180,
    });
    expect(v.series.reduce((s, b) => s + b.cents, 0)).toBe(7000);
    expect(v.series).toHaveLength(30);
    expect(v.topTitles.map((t) => [t.title, t.cents])).toEqual([
      ['Mais pago', 5000],
      ['Já pago', 2000],
    ]);
    // checkout orders created in the period: 4 (the manual one isn't from the checkout); 3 paid
    expect(v.conversion).toEqual({ created: 4, paid: 3, percent: 75 });
    expect(v.granularity).toBe('day');
    expect((await analytics(365, now)).granularity).toBe('month');
  });
});
