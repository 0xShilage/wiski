/**
 * "Seu ano na Wiskiflix" (2026-11-12): what the recap counts for a viewer's São Paulo calendar
 * year — paid sponsorships and contributions (anonymous ones too), the live's watched titles,
 * reviews and likes received, suggestions, Roleta, badges — and what it leaves out.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@/generated/prisma/client';
import { personaOf, recapCards, recapHighlights, yearBounds } from '@/lib/recap';
import { db } from '@/server/db';
import { recapFor } from '@/server/recap/recap';
import { clearCatalog, makeAsset, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { fundedCampaign, paidMovie } from '../support/live';
import { testPublicCode } from '../support/orders';

beforeEach(async () => {
  await clearCatalog();
});

const NOW = new Date('2026-11-12T15:00:00Z');
const IN_2026 = new Date('2026-06-10T20:00:00Z');
/** 31 Dec 2025, 23:30 in São Paulo — still 2025 there */
const LATE_2025 = new Date('2026-01-01T02:30:00Z');

async function contribution(user: User, paidAt: Date, showSponsorName = false) {
  const { item, campaign } = await fundedCampaign();
  await db().order.create({
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
      paidAt,
      showSponsorName,
      clientRequestId: randomUUID(),
    },
  });
  return item;
}

async function watched(itemId: string, at: Date, runtime?: number) {
  await db().catalogItem.update({
    where: { id: itemId },
    data: {
      status: 'WATCHED',
      watchedAt: at,
      ...(runtime ? { runtimeMinutes: runtime } : {}),
    },
  });
  await db().watchEvent.create({ data: { itemId, watchedAt: at } });
}

describe('recap', () => {
  it('year bounds are São Paulo midnights', () => {
    const { start, end } = yearBounds(2026);
    expect(start.toISOString()).toBe('2026-01-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('counts the viewer’s year and the live’s, and nothing from another year or person', async () => {
    const u = await makeUser();
    const other = await makeUser();

    // sponsorships: two this year (one watched on stream), one late 2025, someone else's
    const a = await paidMovie({ user: u, paidAt: IN_2026, runtime: 120, title: 'Alien' });
    await paidMovie({ user: u, paidAt: NOW, runtime: 95, title: 'Coraline' });
    await paidMovie({ user: u, paidAt: LATE_2025, title: 'Velho' });
    const c = await paidMovie({ user: other, paidAt: IN_2026, runtime: 100, title: 'Outro' });
    await watched(a.item.id, new Date('2026-07-01T23:00:00Z'));
    await watched(c.item.id, new Date('2026-08-01T23:00:00Z'));
    // a series watched this year, and a film watched off stream (not counted)
    const series = await makeItem({ kind: 'SERIES', status: 'ACTIVE', title: 'Dark' });
    await watched(series.id, new Date('2026-09-01T23:00:00Z'));
    const off = await makeItem({ kind: 'MOVIE', status: 'ACTIVE', title: 'Em casa' });
    await db().catalogItem.update({ where: { id: off.id }, data: { offStream: true } });
    await watched(off.id, new Date('2026-09-02T23:00:00Z'));

    // contributions: two seats in one campaign + one anonymous elsewhere
    const s1 = await contribution(u, IN_2026, true);
    await contribution(u, NOW);

    // a live that happened
    await db().streamSession.create({
      data: {
        startsAt: new Date('2026-07-01T22:00:00Z'),
        startedAt: new Date('2026-07-01T22:00:00Z'),
        endsAt: new Date('2026-07-02T02:00:00Z'),
        capacityMinutes: 240,
        status: 'DONE',
      },
    });

    // reviews: 2 this year (5 and 4 stars), likes from others (+ their own like doesn't count)
    const r1 = await db().review.create({
      data: { userId: u.id, itemId: a.item.id, rating: 5, body: 'Clássico.', createdAt: IN_2026 },
    });
    await db().review.create({
      data: { userId: u.id, itemId: series.id, rating: 4, body: 'Confuso!', createdAt: NOW },
    });
    for (let i = 0; i < 3; i++) {
      const fan = await makeUser();
      await db().reviewLike.create({ data: { userId: fan.id, reviewId: r1.id } });
    }

    // suggestions: 3, one taken; Roleta: 3 spins, 1 prize
    for (const [i, status] of (['NEW', 'WATCHED', 'DISMISSED'] as const).entries())
      await db().suggestion.create({
        data: {
          userId: u.id,
          kind: 'MOVIE',
          title: `Sugestão ${i}`,
          titleKey: `sugestao ${i}`,
          status,
          createdAt: IN_2026,
          ...(status === 'NEW' ? {} : { reviewedById: other.id, reviewedAt: NOW }),
        },
      });
    const period = new Date('2026-11-04T00:00:00Z');
    await db().roletaSpin.create({ data: { userId: u.id, period, n: 1, prize: 'NADA', slot: 1 } });
    await db().roletaSpin.create({ data: { userId: u.id, period, n: 2, prize: 'NADA', slot: 3 } });
    await db().roletaSpin.create({
      data: {
        userId: u.id,
        period,
        n: 3,
        prize: 'VIP_TWITCH',
        slot: 4,
        status: 'PENDING',
        twitchLogin: 'fulano',
      },
    });

    // a badge claimed this year
    const art = await makeAsset('BADGE');
    const badge = await db().badge.create({
      data: {
        slug: 'maratona',
        name: 'Maratona',
        description: '',
        assetId: art.id,
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    await db().badgeClaim.create({ data: { badgeId: badge.id, userId: u.id } });

    const r = await recapFor(u, 2026, NOW);
    expect(r.year).toBe(2026);
    expect(r.site).toMatchObject({ titles: 3, movies: 2, series: 1, movieMinutes: 220 });
    expect(r.site.lives).toBeGreaterThanOrEqual(1);
    expect(r.site.wall.map((t) => t.title)).toEqual(['Dark', 'Outro', 'Alien']);

    expect(r.mine.sponsorships).toBe(2);
    expect(r.mine.sponsored.map((t) => t.title)).toEqual(['Alien', 'Coraline']);
    expect(r.mine.minutes).toBe(120);
    expect(r.mine.contributions).toBe(2);
    expect(r.mine.supported.map((t) => t.slug)).toContain(s1.slug);
    expect(r.mine.reviews).toBe(2);
    expect(r.mine.averageRating).toBe(4.5);
    expect(r.mine.likesReceived).toBe(3);
    expect(r.mine.topReview).toMatchObject({ title: 'Alien', likes: 3, rating: 5 });
    expect(r.mine.suggestions).toBe(3);
    expect(r.mine.suggestionsTaken).toBe(1);
    expect(r.mine.spins).toBe(3);
    expect(r.mine.prizes).toBe(1);
    expect(r.mine.badges.map((x) => x.name)).toEqual(['Maratona']);
    // never an amount anywhere in what the page gets
    expect(JSON.stringify(r)).not.toMatch(/cents|total|1000/i);

    expect(recapCards(r)).toEqual([
      'intro',
      'live',
      'sponsored',
      'supported',
      'reviews',
      'suggestions',
      'roleta',
      'badges',
      'persona',
      'final',
    ]);
    expect(personaOf(r.mine).id).toBe('patrocinio');
    expect(recapHighlights(r).map((h) => `${h.value} ${h.label}`)).toEqual([
      '2 filmes patrocinados',
      '2 h de live por sua causa',
      '2 cadeiras nas vaquinhas',
      '2 avaliações',
      '3 curtidas recebidas',
      '3 sugestões',
    ]);

    // 2025 holds only the late-December sponsorship
    const last = await recapFor(u, 2025, NOW);
    expect(last.mine.sponsorships).toBe(1);
    expect(last.mine.reviews).toBe(0);
    expect(last.mine.badges).toEqual([]);
    expect(last.site.titles).toBe(0);
  });

  it('a quiet year: just the live, the role "Primeira fila" and its numbers', async () => {
    const u = await makeUser();
    const m = await makeItem({ kind: 'MOVIE', status: 'ACTIVE', title: 'Psicose' });
    await watched(m.id, IN_2026, 109);
    const r = await recapFor(u, 2026, NOW);
    expect(recapCards(r)).toEqual(['intro', 'live', 'persona', 'final']);
    expect(personaOf(r.mine).id).toBe('primeira-fila');
    expect(recapHighlights(r)).toEqual([{ value: '1', label: 'título assistido na live' }]);
  });
});
