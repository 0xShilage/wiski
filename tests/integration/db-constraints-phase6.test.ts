/**
 * Phase 6 reviewed SQL (prisma/migrations/*_phase6_constraints): the Links page and suggestions,
 * hit directly through the app role. The 50/50/10 live limits are in db-constraints-r1.test.ts.
 * Also 20261108120100_manual_price_orders_constraints: manual movie prices and "Já pago" orders.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { pgErrorCode, PG } from '@/server/db-errors';
import { randomBytes, randomUUID } from 'node:crypto';
import { newPublicCode } from '@/server/checkout/buyer';
import { makeItem } from '../support/catalog';
import { makeUser } from '../support/db';

async function rejects(p: Promise<unknown>, sqlstate: string = PG.checkViolation) {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, 'expected the database to refuse').not.toBeNull();
  const code = pgErrorCode(err) ?? (err as { code?: string }).code;
  if (sqlstate === PG.uniqueViolation) expect(['23505', 'P2002']).toContain(code);
  else expect(code).toBe(sqlstate);
}

beforeEach(async () => {
  await db().socialLink.deleteMany({});
});

describe('SocialLink', () => {
  const link = (over: Record<string, unknown> = {}) =>
    db().socialLink.create({
      data: { label: 'Twitch', url: 'https://twitch.tv/wiski', position: 1, ...over },
    });

  it('https only, a real host, no user-info or spaces; label/note lengths; positions 1–30', async () => {
    await rejects(link({ url: 'http://twitch.tv/wiski' }));
    // eslint-disable-next-line no-script-url -- hostile input under test
    await rejects(link({ url: 'javascript:alert(1)//x.y' }));
    await rejects(link({ url: 'https://localhost/x' }));
    await rejects(link({ url: 'https://user@evil.example/x' }));
    await rejects(link({ url: 'https://twitch.tv/a b' }));
    await rejects(link({ url: `https://x.example/${'a'.repeat(300)}` }));
    await rejects(link({ label: '' }));
    await rejects(link({ label: 'x'.repeat(41) }));
    await rejects(link({ note: 'x'.repeat(81) }));
    await rejects(link({ position: 0 }));
    await rejects(link({ position: 31 }));
    await expect(link({ url: 'https://youtube.com/@wiski?si=1#top' })).resolves.toBeTruthy();
  });

  it('positions are unique, checked at COMMIT (a swap in one transaction works)', async () => {
    const a = await link({ position: 1 });
    const b = await link({ position: 2, label: 'YouTube', url: 'https://youtube.com/@wiski' });
    await rejects(
      db().socialLink.update({ where: { id: b.id }, data: { position: 1 } }),
      PG.exclusionViolation,
    );
    await db().$transaction(async (t) => {
      await t.socialLink.update({ where: { id: a.id }, data: { position: 2 } });
      await t.socialLink.update({ where: { id: b.id }, data: { position: 1 } });
    });
    expect((await db().socialLink.findUniqueOrThrow({ where: { id: b.id } })).position).toBe(1);
  });
});

describe('Suggestion', () => {
  it('lengths, a normalised key, year range; reviewer/time exactly when decided', async () => {
    const u = await makeUser();
    const mod = await makeUser({ role: 'MODERATOR' });
    const mk = (over: Record<string, unknown> = {}) =>
      db().suggestion.create({
        data: { userId: u.id, kind: 'MOVIE', title: 'Duna', titleKey: 'duna', ...over },
      });
    await rejects(mk({ title: '' }));
    await rejects(mk({ title: 'x'.repeat(121) }));
    await rejects(mk({ titleKey: 'Duna' }));
    await rejects(mk({ titleKey: ' duna' }));
    await rejects(mk({ titleKey: 'duna  2' }));
    await rejects(mk({ year: 1800 }));
    await rejects(mk({ note: 'x'.repeat(281) }));
    await rejects(mk({ status: 'ACCEPTED' })); // no reviewedAt
    await rejects(mk({ reviewedAt: new Date(), reviewedById: mod.id })); // NEW with a reviewer
    const s = await mk();
    await expect(
      db().suggestion.update({
        where: { id: s.id },
        data: { status: 'DISMISSED', reviewedAt: new Date(), reviewedById: mod.id },
      }),
    ).resolves.toBeTruthy();
  });

  it('one waiting suggestion per viewer and title; decided ones do not count', async () => {
    const u = await makeUser();
    const mod = await makeUser({ role: 'MODERATOR' });
    const mk = () =>
      db().suggestion.create({
        data: { userId: u.id, kind: 'MOVIE', title: 'Duna', titleKey: 'duna' },
      });
    const first = await mk();
    await rejects(mk(), PG.uniqueViolation);
    await db().suggestion.update({
      where: { id: first.id },
      data: { status: 'ACCEPTED', reviewedAt: new Date(), reviewedById: mod.id },
    });
    await expect(mk()).resolves.toBeTruthy();
    // another viewer may wait with the same title
    const other = await makeUser();
    await expect(
      db().suggestion.create({
        data: { userId: other.id, kind: 'MOVIE', title: 'DUNA', titleKey: 'duna' },
      }),
    ).resolves.toBeTruthy();
  });
});

describe('manual price and "Já pago" orders (2026-11-02)', () => {
  it('manualPriceCents: movies only, R$ 5–2.000', async () => {
    const movie = await makeItem({ kind: 'MOVIE' });
    const series = await makeItem({ kind: 'SERIES' });
    const price = (id: string, manualPriceCents: number) =>
      db().catalogItem.update({ where: { id }, data: { manualPriceCents } });
    await rejects(price(series.id, 6000));
    await rejects(price(movie.id, 499));
    await rejects(price(movie.id, 200_001));
    await expect(price(movie.id, 6000)).resolves.toBeTruthy();
  });

  it('a MANUAL order is born paid, never pending, never with an IP key; any positive contribution', async () => {
    const series = await makeItem({ kind: 'SERIES' });
    const opener = await makeUser({ role: 'STREAMER' });
    const now = new Date();
    const campaign = await db().campaign.create({
      data: {
        itemId: series.id,
        goalCents: 10_000,
        remainingCents: 10_000,
        openedAt: now,
        deadlineAt: new Date(now.getTime() + 86_400_000),
        openedById: opener.id,
      },
    });
    const order = (over: Record<string, unknown>) =>
      db().order.create({
        data: {
          publicCode: newPublicCode(),
          kind: 'CONTRIBUTION',
          source: 'MANUAL',
          itemId: series.id,
          campaignId: campaign.id,
          contactEmail: 'iara@example.com',
          buyerKey: `e:${'a'.repeat(64)}`,
          accessTokenHash: new Uint8Array(randomBytes(32)),
          breakdown: [],
          subtotalCents: 1_234,
          totalCents: 1_234,
          status: 'PAID',
          paidAt: now,
          clientRequestId: randomUUID(),
          ...over,
        },
      });
    await rejects(order({ status: 'PENDING_PAYMENT', paidAt: null }));
    await rejects(order({ ipKey: 'abcdefghijklmnop', status: 'PENDING_PAYMENT', paidAt: null }));
    await expect(order({})).resolves.toBeTruthy(); // R$ 12,34: allowed for MANUAL only
    await rejects(order({ source: 'CHECKOUT' }));
  });
});
