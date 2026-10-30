/**
 * Phase 3 reviewed SQL (prisma/migrations/*_phase3_constraints): every CHECK and trigger, hit
 * directly through the app role so a bug in the API can't break the invariants.
 */
import { describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { pgErrorCode, PG } from '@/server/db-errors';
import { agedUser, makeReview, watchedItem } from '../support/reviews';

async function rejects(p: Promise<unknown>, sqlstate: string = PG.checkViolation) {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, 'expected the database to refuse').not.toBeNull();
  expect(pgErrorCode(err) ?? (err as { code?: string }).code).toBe(sqlstate);
}

describe('Review', () => {
  it('AUTO_HIDDEN ⇔ a hold reason', async () => {
    const item = await watchedItem();
    const r = await makeReview(item.id);
    await rejects(db().review.update({ where: { id: r.id }, data: { status: 'AUTO_HIDDEN' } }));
    await rejects(db().review.update({ where: { id: r.id }, data: { heldReason: 'LINKS' } }));
    await db().review.update({
      where: { id: r.id },
      data: { status: 'AUTO_HIDDEN', heldReason: 'LINKS' },
    });
  });

  it('rating 1–5, body 1–2000, counters ≥ 0, times after creation', async () => {
    const item = await watchedItem();
    const r = await makeReview(item.id);
    await rejects(db().review.update({ where: { id: r.id }, data: { rating: 6 } }));
    await rejects(db().review.update({ where: { id: r.id }, data: { body: '' } }));
    await rejects(db().review.update({ where: { id: r.id }, data: { body: 'x'.repeat(2001) } }));
    await rejects(db().review.update({ where: { id: r.id }, data: { openReportCount: -1 } }));
    await rejects(db().review.update({ where: { id: r.id }, data: { likeCount: -1 } }));
    await rejects(
      db().review.update({
        where: { id: r.id },
        data: { editedAt: new Date(r.createdAt.getTime() - 1000) },
      }),
    );
    await rejects(db().review.update({ where: { id: r.id }, data: { moderatedAt: new Date(0) } }));
  });

  it('one review per person per item', async () => {
    const item = await watchedItem();
    const u = await agedUser(5);
    await makeReview(item.id, u);
    await rejects(makeReview(item.id, u), PG.uniqueViolation);
  });
});

describe('ReviewLike / ReviewReport triggers', () => {
  it('nobody likes or reports their own review', async () => {
    const item = await watchedItem();
    const u = await agedUser(5);
    const r = await makeReview(item.id, u);
    await rejects(db().reviewLike.create({ data: { userId: u.id, reviewId: r.id } }));
    await rejects(
      db().reviewReport.create({ data: { reviewId: r.id, reporterId: u.id, reason: 'SPAM' } }),
    );
  });

  it('likeCount follows the rows, whatever writes them (incl. a cascade)', async () => {
    const item = await watchedItem();
    const r = await makeReview(item.id);
    const users = await Promise.all([agedUser(1), agedUser(1), agedUser(1)]);
    await db().reviewLike.createMany({
      data: users.map((u) => ({ userId: u.id, reviewId: r.id })),
    });
    expect((await db().review.findUniqueOrThrow({ where: { id: r.id } })).likeCount).toBe(3);
    await db().reviewLike.delete({
      where: { userId_reviewId: { userId: users[0]!.id, reviewId: r.id } },
    });
    expect((await db().review.findUniqueOrThrow({ where: { id: r.id } })).likeCount).toBe(2);
    await db().user.delete({ where: { id: users[1]!.id } }); // cascade deletes the like
    expect((await db().review.findUniqueOrThrow({ where: { id: r.id } })).likeCount).toBe(1);
    await db().review.delete({ where: { id: r.id } }); // cascade from the review itself: no error
  });

  it('openReportCount counts OPEN reports through inserts, resolutions and deletes', async () => {
    const item = await watchedItem();
    const r = await makeReview(item.id);
    const [a, b] = await Promise.all([agedUser(2), agedUser(2)]);
    const p1 = await db().reviewReport.create({
      data: { reviewId: r.id, reporterId: a.id, reason: 'SPAM' },
    });
    await db().reviewReport.create({ data: { reviewId: r.id, reporterId: b.id, reason: 'OTHER' } });
    const count = async () =>
      (await db().review.findUniqueOrThrow({ where: { id: r.id } })).openReportCount;
    expect(await count()).toBe(2);
    await db().reviewReport.update({
      where: { id: p1.id },
      data: { status: 'DISMISSED', resolvedAt: new Date() },
    });
    expect(await count()).toBe(1);
    await db().reviewReport.deleteMany({ where: { reviewId: r.id, status: 'OPEN' } });
    expect(await count()).toBe(0);
  });

  it('report values: note 1–500; OPEN ⇔ unresolved; the review never changes', async () => {
    const item = await watchedItem();
    const r = await makeReview(item.id);
    const other = await makeReview(item.id);
    const u = await agedUser(2);
    await rejects(
      db().reviewReport.create({
        data: { reviewId: r.id, reporterId: u.id, reason: 'SPAM', note: '' },
      }),
    );
    await rejects(
      db().reviewReport.create({
        data: { reviewId: r.id, reporterId: u.id, reason: 'SPAM', note: 'x'.repeat(501) },
      }),
    );
    const p = await db().reviewReport.create({
      data: { reviewId: r.id, reporterId: u.id, reason: 'SPAM' },
    });
    await rejects(db().reviewReport.update({ where: { id: p.id }, data: { status: 'ACTIONED' } }));
    await rejects(
      db().reviewReport.update({ where: { id: p.id }, data: { resolvedAt: new Date() } }),
    );
    await rejects(db().reviewReport.update({ where: { id: p.id }, data: { resolvedById: u.id } }));
    await rejects(db().reviewReport.update({ where: { id: p.id }, data: { reviewId: other.id } }));
  });
});
