/**
 * Design batch (2026-11-10): the "AO VIVO" bar's status (GET /api/v1/live) and the cinema ticket
 * on a paid order (seat = place in the Fila tab, public name, nothing before payment).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GET as liveRoute } from '@/app/api/v1/live/route';
import { GET as orderRoute } from '@/app/api/v1/orders/[code]/route';
import { db } from '@/server/db';
import { ticketOf } from '@/server/checkout/ticket';
import { clearCatalog } from '../support/catalog';
import { as, hit, makeSession, paidMovie, resetSlots } from '../support/live';

async function noLive() {
  await db().streamSession.updateMany({
    where: { status: 'LIVE' },
    data: { status: 'PLANNED', startedAt: null, nowItemId: null },
  });
}

beforeEach(async () => {
  await clearCatalog();
  resetSlots();
  await noLive();
});

describe('GET /api/v1/live', () => {
  it('off without a live; on with what is on screen while a live is "Ao vivo"', async () => {
    let r = await hit(liveRoute, 'GET', '/api/v1/live');
    expect(r.res.status).toBe(200);
    expect(r.json).toEqual({ live: false, now: null });

    const s = await makeSession({ status: 'LIVE', inHours: 0 });
    r = await hit(liveRoute, 'GET', '/api/v1/live');
    expect(r.json).toEqual({ live: true, now: null });

    const { item } = await paidMovie({ title: 'Duna' });
    await db().streamSession.update({ where: { id: s.id }, data: { nowItemId: item.id } });
    r = await hit(liveRoute, 'GET', '/api/v1/live');
    expect(r.json).toEqual({ live: true, now: 'Duna' });
    await noLive();
  });
});

describe('cinema ticket', () => {
  it('seat = place in the Fila; the public name; anonymous → no name', async () => {
    const fan = await as('USER');
    const first = await paidMovie({ title: 'Primeiro', paidAt: new Date(Date.now() - 60_000) });
    const mine = await paidMovie({ title: 'Meu', user: fan.user });
    const t1 = await ticketOf(first.order);
    const t2 = await ticketOf(mine.order);
    expect(t1).toMatchObject({ seat: 1, name: null, watched: false });
    expect(t2).toMatchObject({ seat: 2, name: `@${fan.user.username}`, watched: false });

    const guest = await paidMovie({ title: 'Convidado', guestName: 'Tia Lu' });
    expect((await ticketOf(guest.order))?.name).toBe('Tia Lu');
    const anon = await db().order.update({
      where: { id: guest.order.id },
      data: { showSponsorName: false },
    });
    expect((await ticketOf(anon))?.name).toBeNull();
  });

  it('none before payment; a watched title has no seat', async () => {
    const { order } = await paidMovie({ title: 'Pendente' });
    const pending = await db().order.update({
      where: { id: order.id },
      data: { status: 'PENDING_PAYMENT', paidAt: null },
    });
    expect(await ticketOf(pending)).toBeNull();
    expect(await ticketOf({ ...order, status: 'COMPLETED' })).toMatchObject({
      seat: null,
      watched: true,
    });
  });

  it('comes with the order page data, for the owner', async () => {
    const fan = await as('USER');
    const { order } = await paidMovie({ title: 'No pedido', user: fan.user });
    const r = await hit(orderRoute, 'GET', `/api/v1/orders/${order.publicCode}`, {
      who: fan,
      params: { code: order.publicCode },
    });
    expect(r.res.status).toBe(200);
    const ticket = (r.json.order as { ticket: Record<string, unknown> }).ticket;
    expect(ticket).toMatchObject({ seat: 1, name: `@${fan.user.username}`, watched: false });
    expect(Object.keys(ticket).sort()).toEqual(['name', 'poster', 'seat', 'watched']);
  });
});
