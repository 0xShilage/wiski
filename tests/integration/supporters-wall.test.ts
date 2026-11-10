/**
 * Mural de apoiadores (2026-11-09): opt-in at checkout ("Quero aparecer no mural", off by
 * default; never with "anônimo"), a thank-you per title with the names of those who opted in,
 * newest first; refunded orders and unsafe names stay off; moderators can take a name off.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as textsRoute } from '@/app/api/v1/admin/orders/[id]/texts/route';
import { db } from '@/server/db';
import { supportersWall } from '@/server/wall/wall';
import { clearCatalog } from '../support/catalog';
import { type Legal, liveMovie, movieBody, sponsor } from '../support/checkout';
import { as, hit, paidMovie, resetSlots } from '../support/live';
import { ensureLegal, installFakeMp } from '../support/mercadopago';

let legal: Legal;
beforeAll(async () => {
  legal = await ensureLegal();
});
beforeEach(async () => {
  installFakeMp();
  await clearCatalog();
  resetSlots();
});

describe('checkout opt-in', () => {
  it('off by default; on when ticked; never together with "anônimo"', async () => {
    const order = async (over: Record<string, unknown>) => {
      const movie = await liveMovie(100);
      const r = await sponsor(
        movieBody(movie.id, legal, { expectedTotalCents: 2000, displayName: 'Tia Lu', ...over }),
      );
      expect(r.res.status).toBe(201);
      return db().order.findFirstOrThrow({ where: { itemId: movie.id } });
    };
    expect((await order({})).wallOptIn).toBe(false);
    expect((await order({ wall: true })).wallOptIn).toBe(true);
    expect((await order({ wall: true, anonymous: true })).wallOptIn).toBe(false);
  });
});

describe('the wall', () => {
  it('only opted-in, counted orders with a safe public name; newest first; one card per title', async () => {
    const fan = await as('USER');
    const a = await paidMovie({
      title: 'Antigo',
      user: fan.user,
      paidAt: new Date(Date.now() - 9e5),
    });
    const b = await paidMovie({ title: 'Novo', guestName: 'Tia Lu', paidAt: new Date() });
    const hidden = await paidMovie({ title: 'Sem opt-in', guestName: 'Ninguém' });
    const refunded = await paidMovie({ title: 'Reembolsado', guestName: 'Beto' });
    const rude = await paidMovie({ title: 'Nome feio', guestName: 'caralho' });
    await db().order.update({ where: { id: a.order.id }, data: { wallOptIn: true } });
    for (const o of [b, refunded, rude]) {
      await db().order.update({
        where: { id: o.order.id },
        data: { wallOptIn: true, displayNameStatus: 'APPROVED' },
      });
    }
    await db().order.update({
      where: { id: refunded.order.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    expect(hidden.order.wallOptIn).toBe(false);

    const wall = await supportersWall();
    expect(wall.map((e) => [e.title, e.names])).toEqual([
      ['Novo', ['Tia Lu']],
      ['Antigo', [`@${fan.user.username}`]],
    ]);
    expect(wall[0]).toMatchObject({ kind: 'MOVIE', campaign: false });
  });

  it('a moderator takes a name off (and cannot put it back)', async () => {
    const { order } = await paidMovie({ title: 'Com nome', guestName: 'Tia Lu' });
    await db().order.update({
      where: { id: order.id },
      data: { wallOptIn: true, displayNameStatus: 'APPROVED' },
    });
    expect(await supportersWall()).toHaveLength(1);
    const mod = await as('MODERATOR');
    const off = await hit(textsRoute, 'POST', '', {
      who: mod,
      params: { id: order.id },
      body: { expectedVersion: order.version, wall: false },
    });
    expect(off.res.status).toBe(200);
    expect(await supportersWall()).toHaveLength(0);
    const back = await hit(textsRoute, 'POST', '', {
      who: mod,
      params: { id: order.id },
      body: { expectedVersion: order.version, wall: true },
    });
    expect(back.res.status).toBe(422);
    expect(
      await db().auditLog.count({ where: { action: 'order.texts', targetId: order.id } }),
    ).toBe(1);
  });
});
