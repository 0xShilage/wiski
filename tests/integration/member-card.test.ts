/**
 * Membership card on /perfil (2026-11-11): the viewer's own numbers. Private page, so anonymous
 * sponsorships count; refunded or unpaid orders don't; "minutos de live" only from films that were
 * watched on stream (an off-stream log doesn't count).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { memberStats } from '@/server/community/member-card';
import { db } from '@/server/db';
import { clearCatalog } from '../support/catalog';
import { as, paidMovie, resetSlots } from '../support/live';

beforeEach(async () => {
  await clearCatalog();
  resetSlots();
});

const watch = (itemId: string, offStream = false) =>
  db().catalogItem.update({
    where: { id: itemId },
    data: { status: 'WATCHED', watchedAt: new Date(), slot: null, offStream },
  });

describe('memberStats', () => {
  it('counts every paid order (anonymous too) and only the minutes watched on stream', async () => {
    const v = await as('USER');
    const live = await paidMovie({ user: v.user, title: 'Visto na live', runtime: 120 });
    const anon = await paidMovie({ user: v.user, title: 'Patrocínio anônimo', runtime: 90 });
    const refunded = await paidMovie({ user: v.user, title: 'Reembolsado', runtime: 80 });
    const solo = await paidMovie({ user: v.user, title: 'Visto fora da live', runtime: 70 });
    await paidMovie({ title: 'De um convidado', runtime: 60 }); // someone else's

    await db().order.update({ where: { id: anon.order.id }, data: { showSponsorName: false } });
    await db().order.update({ where: { id: refunded.order.id }, data: { status: 'REFUNDED' } });
    await watch(live.item.id); // the order stays paid; "watched on stream" is the item's fact
    await watch(solo.item.id, true);

    expect(await memberStats(v.user.id)).toEqual({
      sponsorships: 3, // live + anonymous + off-stream; the refunded one is out
      contributions: 0,
      minutes: 120, // only the film watched on stream
      reviews: 0,
    });
  });

  it('a new account has an empty card', async () => {
    const v = await as('USER');
    expect(await memberStats(v.user.id)).toEqual({
      sponsorships: 0,
      contributions: 0,
      minutes: 0,
      reviews: 0,
    });
  });
});
