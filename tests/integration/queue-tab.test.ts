/**
 * "Fila" (2026-11-09): a paid title (sponsored movie, series/franchise with the goal reached)
 * leaves its tab and frees its slot; it is listed on /fila with its sponsor and its date. Coming
 * back to ACTIVE (a refund, "Desfazer registro", "Desmarcar assistido") takes the lowest free
 * slot — or, with the board full, comes back as a draft. Publishing a draft still has to fit.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LIVE_LIMIT } from '@/lib/catalog/pricing';
import { db } from '@/server/db';
import { getPublic, listPublic } from '@/server/catalog/read';
import { publicQueue } from '@/server/live/public';
import { clearCatalog, makeItem } from '../support/catalog';
import { withAdmin } from '../support/db';
import { as, fundedCampaign, makeSession, paidMovie, resetSlots } from '../support/live';

beforeEach(async () => {
  await clearCatalog();
  await db().streamSession.deleteMany({});
  resetSlots();
});

async function fillMovies(n: number) {
  for (let slot = 1; slot <= n; slot++) {
    await makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot, title: `Livre ${slot}` });
  }
}

describe('a paid title frees its slot', () => {
  it('a sponsored movie leaves Filmes, shows on /fila, and its slot takes a new movie', async () => {
    await fillMovies(LIVE_LIMIT.MOVIE);
    const sold = await db().catalogItem.findFirstOrThrow({ where: { slot: 7, kind: 'MOVIE' } });
    await db().catalogItem.update({ where: { id: sold.id }, data: { status: 'SPONSORED' } });
    const after = await db().catalogItem.findUniqueOrThrow({ where: { id: sold.id } });
    expect([after.status, after.slot]).toEqual(['SPONSORED', null]);

    const tab = await listPublic('MOVIE');
    expect(tab).toHaveLength(LIVE_LIMIT.MOVIE - 1);
    expect(tab.map((i) => i.id)).not.toContain(sold.id);
    // the title page still opens
    expect((await getPublic('MOVIE', sold.slug))?.id).toBe(sold.id);

    // a new movie fits in slot 7
    const draft = await makeItem({ kind: 'MOVIE', status: 'DRAFT', slot: null });
    await db().catalogItem.update({
      where: { id: draft.id },
      data: { status: 'ACTIVE', slot: 7, publishedAt: new Date() },
    });
    expect(await db().catalogItem.count({ where: { kind: 'MOVIE', status: 'ACTIVE' } })).toBe(
      LIVE_LIMIT.MOVIE,
    );
  });

  it('a series with its goal reached leaves Séries the same way', async () => {
    const { item } = await fundedCampaign();
    const row = await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([row.status, row.slot]).toEqual(['FUNDED', null]);
    expect((await listPublic('SERIES')).map((i) => i.id)).not.toContain(item.id);
    expect((await publicQueue()).map((e) => e.title)).toContain(item.title);
  });
});

describe('back to ACTIVE', () => {
  it('takes the lowest free slot; with the board full it comes back as a draft', async () => {
    await fillMovies(3);
    const { item } = await paidMovie({ title: 'Reembolsado' });
    expect(item.slot).toBeNull();
    await db().catalogItem.update({ where: { id: item.id }, data: { status: 'ACTIVE' } });
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } })).slot).toBe(4);

    await clearCatalog();
    await fillMovies(LIVE_LIMIT.MOVIE - 1);
    const a = await paidMovie({ title: 'Primeiro' });
    const b = await paidMovie({ title: 'Segundo' });
    // the board is full again (a new movie took the last slot)
    await makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot: LIVE_LIMIT.MOVIE, title: 'Último' });
    await db().catalogItem.update({ where: { id: a.item.id }, data: { status: 'ACTIVE' } });
    const back = await db().catalogItem.findUniqueOrThrow({ where: { id: a.item.id } });
    expect([back.status, back.slot]).toEqual(['DRAFT', null]);
    expect(back.publishedAt).not.toBeNull();
    expect(b.item.slot).toBeNull();
  });

  it('a draft still cannot be published onto a full board', async () => {
    await fillMovies(LIVE_LIMIT.MOVIE - 1);
    const { item } = await paidMovie(); // paid: no slot
    await makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot: LIVE_LIMIT.MOVIE });
    const draft = await makeItem({ kind: 'MOVIE', status: 'DRAFT', slot: null });
    await withAdmin(async (c) => {
      await expect(
        c.query(`UPDATE "CatalogItem" SET status = 'ACTIVE', "publishedAt" = now() WHERE id = $1`, [
          draft.id,
        ]),
      ).rejects.toMatchObject({ code: 'WF409' });
      // and a paid title can never keep a slot
      await expect(
        c.query(`UPDATE "CatalogItem" SET slot = 3 WHERE id = $1`, [item.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});

describe('/fila', () => {
  it('what is on screen, then by date, then the queue order; sponsor names as public', async () => {
    const fan = await as('USER');
    const late = await paidMovie({ title: 'Paga depois', paidAt: new Date(Date.now() - 1_000) });
    const early = await paidMovie({ title: 'Paga antes', paidAt: new Date(Date.now() - 9_000) });
    const jump = await paidMovie({ title: 'Furou a fila', tier: 'prioridade', user: fan.user });
    const anon = await paidMovie({ title: 'Anônima', paidAt: new Date(Date.now() - 5_000) });
    await db().order.update({ where: { id: anon.order.id }, data: { showSponsorName: false } });

    const s = await makeSession({ inHours: 48 });
    await db().order.update({
      where: { id: late.order.id },
      data: { status: 'SCHEDULED', sessionId: s.id, scheduledAt: new Date() },
    });
    const live = await makeSession({ inHours: 0, status: 'LIVE' });
    const now = await paidMovie({ title: 'Agora' });
    await db().order.update({
      where: { id: now.order.id },
      data: { status: 'WATCHING', sessionId: live.id, scheduledAt: new Date() },
    });

    const q = await publicQueue();
    expect(q.map((e) => e.title)).toEqual([
      'Agora',
      'Paga depois',
      'Furou a fila',
      'Paga antes',
      'Anônima',
    ]);
    expect(q[0]!.playing).toBe(true);
    expect(q[1]!.when).toBe(s.startsAt.toISOString());
    expect(q[2]).toMatchObject({ sponsor: `@${fan.user.username}`, jumped: true });
    expect(q[4]!.sponsor).toBeNull();
    expect(early.item.slot).toBeNull();
    expect(jump.item.slot).toBeNull();
  });
});
