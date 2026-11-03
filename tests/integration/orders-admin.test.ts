/**
 * Orders in the dashboard (Phase 4): list/detail (e-mails for the streamer only), approving the
 * sponsor message and guest name, accepting a NEEDS_ATTENTION order, and the exception refund
 * through Mercado Pago (step-up, idempotency, holds given back, webhook → REFUNDED).
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { syncPayment } from '@/server/payments/sync';
import { GET as listRoute } from '@/app/api/v1/admin/orders/route';
import { GET as getRoute } from '@/app/api/v1/admin/orders/[id]/route';
import { POST as textsRoute } from '@/app/api/v1/admin/orders/[id]/texts/route';
import { POST as acceptRoute } from '@/app/api/v1/admin/orders/[id]/accept/route';
import { POST as refundRoute } from '@/app/api/v1/admin/orders/[id]/refund/route';
import { publicSchedule } from '@/server/live/public';
import { clearCatalog } from '../support/catalog';
import {
  contribute,
  contributionBody,
  type Legal,
  liveMovie,
  movieBody,
  openCampaignFor,
  orderByCode,
  sponsor,
} from '../support/checkout';
import { as, hit, makeSession, type Who } from '../support/live';
import { ensureLegal, type FakeMp, installFakeMp } from '../support/mercadopago';

let legal: Legal;
let mp: FakeMp;
beforeAll(async () => {
  legal = await ensureLegal();
});
beforeEach(async () => {
  mp = installFakeMp();
  await clearCatalog();
});

async function paidMovieOrder(over: Record<string, unknown> = {}) {
  const movie = await liveMovie();
  const r = await sponsor(movieBody(movie.id, legal, over));
  expect(r.res.status).toBe(201);
  const pid = (await orderByCode(r.json.publicCode as string)).payment!.providerPaymentId!;
  mp.approve(Number(pid));
  await syncPayment(pid);
  const o = await orderByCode(r.json.publicCode as string);
  expect(o.status).toBe('PAID');
  return { order: o, movie, pid };
}

const refund = (who: Who, id: string, body: unknown, key = randomUUID()) =>
  hit(refundRoute, 'POST', `/api/v1/admin/orders/${id}/refund`, {
    who,
    params: { id },
    body,
    headers: { 'idempotency-key': key },
  });

describe('list and detail', () => {
  it('moderators see the public name, the streamer also the e-mail and the MP id', async () => {
    const { order } = await paidMovieOrder({ contactEmail: 'fulana@example.com' });
    const mod = await as('MODERATOR');
    const s = await as('STREAMER');
    const byMod = await hit(getRoute, 'GET', '', { who: mod, params: { id: order.id } });
    expect((byMod.json.order as { email: string | null }).email).toBeNull();
    expect(JSON.stringify(byMod.json)).not.toContain('fulana@example.com');
    const bySt = await hit(getRoute, 'GET', '', { who: s, params: { id: order.id } });
    expect(bySt.json.order).toMatchObject({ email: 'fulana@example.com', code: order.publicCode });
    const list = await hit(listRoute, 'GET', '/api/v1/admin/orders?status=PAID', { who: mod });
    expect((list.json.orders as { id: string }[]).map((o) => o.id)).toContain(order.id);
    expect(list.json.counts).toMatchObject({ queue: 1 });
    expect(
      (await hit(listRoute, 'GET', '/api/v1/admin/orders?status=NOPE', { who: mod })).res.status,
    ).toBe(422);
  });
});

describe('sponsor message and guest name (Q10, Q16)', () => {
  it('the name stays private until approved; the message shows at once (2026-11-03); audited', async () => {
    const { order } = await paidMovieOrder({
      displayName: 'Lu Convidada',
      message: 'Bora assistir!',
    });
    expect(order).toMatchObject({ displayNameStatus: 'PENDING', messageStatus: 'APPROVED' });
    const mod = await as('MODERATOR');
    const before = await hit(getRoute, 'GET', '', { who: mod, params: { id: order.id } });
    expect(before.json.order).toMatchObject({ publicName: null, shownMessage: 'Bora assistir!' });
    const r = await hit(textsRoute, 'POST', '', {
      who: mod,
      params: { id: order.id },
      body: { expectedVersion: order.version, displayName: 'APPROVED', message: 'REJECTED' },
    });
    expect(r.json.order).toMatchObject({
      publicName: 'Lu Convidada',
      shownMessage: null,
      messageStatus: 'REJECTED',
    });
    const name = await hit(textsRoute, 'POST', '', {
      who: mod,
      params: { id: order.id },
      body: { expectedVersion: order.version, displayName: 'REJECTED' },
    });
    expect([name.res.status, name.json.code]).toEqual([409, 'NOTHING_TO_REVIEW']);
    const same = await hit(textsRoute, 'POST', '', {
      who: mod,
      params: { id: order.id },
      body: { expectedVersion: order.version, message: 'REJECTED' },
    });
    expect([same.res.status, same.json.code]).toEqual([409, 'NOTHING_TO_REVIEW']);
    const back = await hit(textsRoute, 'POST', '', {
      who: mod,
      params: { id: order.id },
      body: { expectedVersion: order.version, message: 'APPROVED' },
    });
    expect(back.json.order).toMatchObject({ shownMessage: 'Bora assistir!' });
    const logs = await db().auditLog.findMany({
      where: { action: 'order.texts', targetId: order.id },
      orderBy: { id: 'asc' },
    });
    expect(logs.map((l) => l.metadata)).toEqual([
      { displayName: 'APPROVED', message: 'REJECTED' },
      { message: 'APPROVED' },
    ]);
    expect(JSON.stringify(logs.map((l) => l.metadata))).not.toContain('Lu Convidada');
  });

  it('no message: nothing to show or hide', async () => {
    const { order } = await paidMovieOrder();
    const r = await hit(textsRoute, 'POST', '', {
      who: await as('MODERATOR'),
      params: { id: order.id },
      body: { expectedVersion: order.version, message: 'REJECTED' },
    });
    expect(r.json.code).toBe('NOTHING_TO_REVIEW');
  });

  it('a stale version is 409', async () => {
    const { order } = await paidMovieOrder({ message: 'Oi' });
    const r = await hit(textsRoute, 'POST', '', {
      who: await as('MODERATOR'),
      params: { id: order.id },
      body: { expectedVersion: order.version + 3, message: 'REJECTED' },
    });
    expect(r.json.code).toBe('ORDER_CHANGED');
  });
});

describe('accepting an order that needs attention', () => {
  async function lateMovie() {
    const movie = await liveMovie();
    const r = await sponsor(movieBody(movie.id, legal));
    const o = await orderByCode(r.json.publicCode as string);
    const pid = o.payment!.providerPaymentId!;
    const late = new Date(o.payment!.expiresAt.getTime() + 5 * 60_000);
    mp.approve(Number(pid), late);
    await syncPayment(pid, late);
    return { order: await orderByCode(o.publicCode), movie, pid };
  }

  it('streamer + step-up; movie still free → PAID and SPONSORED; audited', async () => {
    const { order, movie } = await lateMovie();
    expect(order.status).toBe('NEEDS_ATTENTION');
    const stale = await as('STREAMER', { authTime: new Date(Date.now() - 60 * 60_000) });
    const noStep = await hit(acceptRoute, 'POST', '', {
      who: stale,
      params: { id: order.id },
      body: { expectedVersion: order.version },
    });
    expect([noStep.res.status, noStep.json.code]).toEqual([401, 'STEP_UP_REQUIRED']);
    const r = await hit(acceptRoute, 'POST', '', {
      who: await as('STREAMER'),
      params: { id: order.id },
      body: { expectedVersion: order.version },
    });
    expect((r.json.order as { status: string }).status).toBe('PAID');
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).status).toBe(
      'SPONSORED',
    );
    expect(
      await db().auditLog.count({ where: { action: 'order.accept', targetId: order.id } }),
    ).toBe(1);
  });

  it('the movie went to someone else → 409, nothing changes', async () => {
    const { order, movie } = await lateMovie();
    const other = await sponsor(movieBody(movie.id, legal, { contactEmail: 'outro@example.com' }));
    const opid = (await orderByCode(other.json.publicCode as string)).payment!.providerPaymentId!;
    mp.approve(Number(opid));
    await syncPayment(opid);
    const r = await hit(acceptRoute, 'POST', '', {
      who: await as('STREAMER'),
      params: { id: order.id },
      body: { expectedVersion: order.version },
    });
    expect([r.res.status, r.json.code]).toEqual([409, 'CANNOT_ACCEPT']);
    expect((await orderByCode(order.publicCode)).status).toBe('NEEDS_ATTENTION');
  });

  it('a payment that failed verification is never accepted', async () => {
    const movie = await liveMovie();
    mp.tamperCreate = (p) => {
      p.transaction_amount = 1;
    };
    const r0 = await sponsor(movieBody(movie.id, legal));
    // the tampered amount fails at checkout already; build the case by hand instead
    expect(r0.res.status).toBe(503);
    const { order, pid } = await paidMovieOrder();
    mp.set(Number(pid), { transaction_amount: 1 });
    await syncPayment(pid);
    const o = await orderByCode(order.publicCode);
    expect(o.status).toBe('NEEDS_ATTENTION');
    const r = await hit(acceptRoute, 'POST', '', {
      who: await as('STREAMER'),
      params: { id: o.id },
      body: { expectedVersion: o.version },
    });
    expect(r.json.code).toBe('CANNOT_ACCEPT');
  });
});

describe('exception refunds (04 §8)', () => {
  it('movie: MP refund, order REFUND_PENDING, movie back in the catalogue, session freed; webhook → REFUNDED', async () => {
    const { order, movie, pid } = await paidMovieOrder();
    const s = await makeSession();
    await db().order.update({
      where: { id: order.id },
      data: {
        status: 'SCHEDULED',
        sessionId: s.id,
        scheduledAt: new Date(),
        version: { increment: 1 },
      },
    });
    await db().streamSession.update({
      where: { id: s.id },
      data: { bookedMinutes: order.runtimeMinutes! },
    });
    const st = await as('STREAMER');
    const key = randomUUID();
    const r = await refund(
      st,
      order.id,
      { expectedVersion: order.version + 1, reason: 'DUPLICATE_PAYMENT' },
      key,
    );
    expect(r.json).toMatchObject({ status: 'REFUND_PENDING' });
    expect(mp.refunds).toHaveLength(1);
    const o = await orderByCode(order.publicCode);
    expect(o).toMatchObject({ status: 'REFUND_PENDING', sessionId: null });
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).status).toBe(
      'ACTIVE',
    );
    expect(
      (await db().streamSession.findUniqueOrThrow({ where: { id: s.id } })).bookedMinutes,
    ).toBe(0);
    const row = await db().refund.findFirstOrThrow({ where: { paymentId: o.payment!.id } });
    expect(row).toMatchObject({
      status: 'APPROVED',
      reason: 'DUPLICATE_PAYMENT',
      requestedById: st.user.id,
    });
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'refund.request', targetId: order.id },
    });
    expect(log.metadata).toMatchObject({ reason: 'DUPLICATE_PAYMENT', from: 'SCHEDULED' });

    // replay with the same key: same answer, no second refund
    const again = await refund(
      st,
      order.id,
      { expectedVersion: order.version + 1, reason: 'DUPLICATE_PAYMENT' },
      key,
    );
    expect(again.json).toMatchObject({ status: 'REFUND_PENDING' });
    expect(mp.refunds).toHaveLength(1);

    await syncPayment(pid);
    expect((await orderByCode(order.publicCode)).status).toBe('REFUNDED');
  });

  it('needs step-up and an Idempotency-Key; moderators get 404', async () => {
    const { order } = await paidMovieOrder();
    expect(
      (
        await refund(await as('MODERATOR'), order.id, {
          expectedVersion: order.version,
          reason: 'PROCESSING_ERROR',
        })
      ).res.status,
    ).toBe(404);
    const stale = await as('STREAMER', { authTime: new Date(Date.now() - 60 * 60_000) });
    expect(
      (
        await refund(stale, order.id, {
          expectedVersion: order.version,
          reason: 'PROCESSING_ERROR',
        })
      ).json.code,
    ).toBe('STEP_UP_REQUIRED');
    const noKey = await hit(refundRoute, 'POST', '', {
      who: await as('STREAMER'),
      params: { id: order.id },
      body: { expectedVersion: order.version, reason: 'PROCESSING_ERROR' },
    });
    expect(noKey.res.status).toBe(422);
    expect(mp.refunds).toHaveLength(0);
  });

  it('MP down → 503 and nothing changes; retrying later works', async () => {
    const { order } = await paidMovieOrder();
    mp.failRefund = { status: 500, times: 1 };
    const st = await as('STREAMER');
    const key = randomUUID();
    const r = await refund(
      st,
      order.id,
      { expectedVersion: order.version, reason: 'PROCESSING_ERROR' },
      key,
    );
    expect([r.res.status, r.json.code]).toEqual([503, 'REFUND_PROVIDER_ERROR']);
    expect((await orderByCode(order.publicCode)).status).toBe('PAID');
    const ok = await refund(
      st,
      order.id,
      { expectedVersion: order.version, reason: 'PROCESSING_ERROR' },
      key,
    );
    expect(ok.json.status).toBe('REFUND_PENDING');
  });

  it('a completed / expired order is not refundable', async () => {
    const { order } = await paidMovieOrder();
    await db().order.update({
      where: { id: order.id },
      data: { status: 'COMPLETED', completedAt: new Date(), version: { increment: 1 } },
    });
    const r = await refund(await as('STREAMER'), order.id, {
      expectedVersion: order.version + 1,
      reason: 'LEGAL_REQUIREMENT',
    });
    expect([r.res.status, r.json.code]).toEqual([409, 'NOT_REFUNDABLE']);
  });

  it('contribution to a funded campaign: money leaves the campaign, which opens again', async () => {
    const { campaign, item } = await openCampaignFor(1_000);
    const r = await contribute(campaign.id, contributionBody(1_000, legal));
    const o = await orderByCode(r.json.publicCode as string);
    mp.approve(Number(o.payment!.providerPaymentId));
    await syncPayment(o.payment!.providerPaymentId!);
    expect((await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      'FUNDED',
    );
    const paid = await orderByCode(o.publicCode);
    const rf = await refund(await as('STREAMER'), paid.id, {
      expectedVersion: paid.version,
      reason: 'DUPLICATE_PAYMENT',
    });
    expect(rf.json.status).toBe('REFUND_PENDING');
    const c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({
      status: 'OPEN',
      raisedCents: 0,
      remainingCents: 1_000,
      supporterCount: 0,
      fundedAt: null,
    });
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'ACTIVE',
    );
  });

  it('the schedule never shows a refunded movie', async () => {
    const { order } = await paidMovieOrder();
    await refund(await as('STREAMER'), order.id, {
      expectedVersion: order.version,
      reason: 'DUPLICATE_PAYMENT',
    });
    const sessions = await publicSchedule();
    expect(JSON.stringify(sessions)).not.toContain(order.publicCode);
  });
});
