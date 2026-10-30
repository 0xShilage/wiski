/**
 * R1 reviewed SQL (prisma/migrations/20261002230100_r1_constraints): every new CHECK, the
 * deferred live-slot exclusion, the 35/10/10 live limit trigger, campaign money invariants and
 * the kind-specific Order checks (12 §2 step 2 "done when").
 */
import { testBuyerKey, testPublicCode } from '../support/orders';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { clearCatalog, makeItem } from '../support/catalog';
import { makeUser, withAdmin } from '../support/db';

/** Postgres SQLSTATE of a failed Prisma call (driver adapter error or raw pg error). */
async function sqlState(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return pgCode(err);
  }
  throw new Error('expected the statement to fail');
}

function pgCode(err: unknown): string {
  const e = err as {
    code?: string;
    meta?: { driverAdapterError?: { cause?: { originalCode?: string; code?: string } } };
    cause?: unknown;
  };
  const cause = e.meta?.driverAdapterError?.cause;
  return cause?.originalCode ?? cause?.code ?? e.code ?? 'unknown';
}

beforeEach(async () => {
  await clearCatalog();
});

describe('CatalogItem CHECKs', () => {
  it('rejects malformed slugs, oversized text, bad years and runtimes', async () => {
    const base = await makeItem();
    const upd = (data: Record<string, unknown>) =>
      db().catalogItem.update({ where: { id: base.id }, data });
    for (const data of [
      { slug: 'Com Espaço' },
      { slug: '-x' },
      { slug: 'a'.repeat(81) },
      { title: '' },
      { title: 'x'.repeat(121) },
      { synopsis: 'x'.repeat(601) },
      { year: 1700 },
      { runtimeMinutes: 0 },
      { runtimeMinutes: 361 }, // movie limit
      { genres: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
      { trailerYoutubeId: 'https://youtu.be/abcdefghijk' },
      { trailerYoutubeId: 'abc' },
      { seasonCount: 2 }, // series-only field on a movie
      { slot: 36 },
      { slot: 0 },
      { version: -1 },
      { reservedUntil: new Date() }, // without reservedOrderId
    ]) {
      expect(await sqlState(upd(data)), JSON.stringify(data)).toBe('23514');
    }
    await expect(upd({ trailerYoutubeId: 'dQw4w9WgXcQ', year: 2021 })).resolves.toBeTruthy();
  });

  it('ties status to slot, kind and lifecycle timestamps', async () => {
    // live without slot
    expect(await sqlState(makeItem({ status: 'ACTIVE', slot: null }))).toBe('23514');
    // archived with a slot
    expect(await sqlState(makeItem({ status: 'ARCHIVED', slot: 3 }))).toBe('23514');
    // SPONSORED is movie-only, FUNDED is campaign-only
    expect(await sqlState(makeItem({ kind: 'SERIES', status: 'SPONSORED', slot: 1 }))).toBe(
      '23514',
    );
    expect(await sqlState(makeItem({ kind: 'MOVIE', status: 'FUNDED', slot: 1 }))).toBe('23514');
    // series slots stop at 10
    expect(await sqlState(makeItem({ kind: 'SERIES', status: 'ACTIVE', slot: 11 }))).toBe('23514');
    // live without publishedAt
    const d = await makeItem();
    expect(
      await sqlState(
        db().catalogItem.update({ where: { id: d.id }, data: { status: 'ACTIVE', slot: 1 } }),
      ),
    ).toBe('23514');
  });

  it('kind is immutable', async () => {
    const m = await makeItem();
    expect(
      await sqlState(db().catalogItem.update({ where: { id: m.id }, data: { kind: 'SERIES' } })),
    ).toBe('23514');
  });
});

describe('live slots (deferred exclusion)', () => {
  it('two live items of the same kind cannot share a slot; drafts and other kinds can', async () => {
    await makeItem({ status: 'ACTIVE', slot: 5 });
    expect(await sqlState(makeItem({ status: 'ACTIVE', slot: 5 }))).toBe('23P01');
    expect(await sqlState(makeItem({ status: 'WATCHED', slot: 5 }))).toBe('23P01');
    await expect(makeItem({ status: 'DRAFT', slot: 5 })).resolves.toBeTruthy();
    await expect(makeItem({ kind: 'SERIES', status: 'ACTIVE', slot: 5 })).resolves.toBeTruthy();
  });

  it('a permutation of slots inside one transaction succeeds (checked at COMMIT)', async () => {
    const a = await makeItem({ status: 'ACTIVE', slot: 1 });
    const b = await makeItem({ status: 'ACTIVE', slot: 2 });
    await db().$transaction([
      db().catalogItem.update({ where: { id: a.id }, data: { slot: 2 } }),
      db().catalogItem.update({ where: { id: b.id }, data: { slot: 1 } }),
    ]);
    const rows = await db().catalogItem.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(Object.fromEntries(rows.map((r) => [r.id, r.slot]))).toEqual({ [a.id]: 2, [b.id]: 1 });
    // …but a transaction that ends with a duplicate is rolled back.
    expect(
      await sqlState(
        db().$transaction([db().catalogItem.update({ where: { id: a.id }, data: { slot: 1 } })]),
      ),
    ).toBe('23P01');
  });
});

describe('live limit trigger (35 movies, 10 series, 10 franchises)', () => {
  it('refuses the 36th live movie with SQLSTATE WF409, counting WATCHED too', async () => {
    for (let slot = 1; slot <= 34; slot++) await makeItem({ status: 'ACTIVE', slot });
    await makeItem({ status: 'WATCHED', slot: 35 });
    expect(await sqlState(makeItem({ status: 'ACTIVE', slot: 35 }))).toBe('WF409');
    const draft = await makeItem({ status: 'DRAFT' });
    expect(
      await sqlState(
        db().catalogItem.update({
          where: { id: draft.id },
          data: { status: 'ACTIVE', slot: 20, publishedAt: new Date() },
        }),
      ),
    ).toBe('WF409');
    // Archiving one frees room.
    const watched = await db().catalogItem.findFirstOrThrow({ where: { status: 'WATCHED' } });
    await db().catalogItem.update({
      where: { id: watched.id },
      data: { status: 'ARCHIVED', slot: null, archivedAt: new Date() },
    });
    await expect(
      db().catalogItem.update({
        where: { id: draft.id },
        data: { status: 'ACTIVE', slot: 35, publishedAt: new Date() },
      }),
    ).resolves.toBeTruthy();
  });

  it('counts per kind: 10 series and 10 franchises', async () => {
    for (let slot = 1; slot <= 10; slot++) {
      await makeItem({ kind: 'SERIES', status: 'ACTIVE', slot });
      await makeItem({ kind: 'FRANCHISE', status: 'ACTIVE', slot });
    }
    expect(await sqlState(makeItem({ kind: 'SERIES', status: 'ACTIVE', slot: 3 }))).toBe('WF409');
    expect(await sqlState(makeItem({ kind: 'FRANCHISE', status: 'FUNDED', slot: 3 }))).toBe(
      'WF409',
    );
    await expect(makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot: 1 })).resolves.toBeTruthy();
  });

  it('concurrent publishes never exceed the limit (advisory lock)', async () => {
    for (let slot = 1; slot <= 8; slot++)
      await makeItem({ kind: 'SERIES', status: 'ACTIVE', slot });
    const drafts = await Promise.all(
      Array.from({ length: 6 }, () => makeItem({ kind: 'SERIES', status: 'DRAFT' })),
    );
    const results = await Promise.allSettled(
      drafts.map((d, i) =>
        db().catalogItem.update({
          where: { id: d.id },
          data: { status: 'ACTIVE', slot: 9 + (i % 2), publishedAt: new Date() },
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await db().catalogItem.count({ where: { kind: 'SERIES', status: 'ACTIVE' } })).toBe(10);
  });

  it('refuses publishes outside READ COMMITTED', async () => {
    const d = await makeItem();
    await withAdmin(async (c) => {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await expect(
        c.query(
          `UPDATE "CatalogItem" SET status = 'ACTIVE', slot = 1, "publishedAt" = now() WHERE id = $1`,
          [d.id],
        ),
      ).rejects.toThrow(/READ COMMITTED/);
      await c.query('ROLLBACK');
    });
  });
});

describe('franchise entries, revisions, media', () => {
  it('validates values', async () => {
    const f = await makeItem({ kind: 'FRANCHISE' });
    const mod = await makeUser({ role: 'MODERATOR' });
    expect(
      await sqlState(
        db().franchiseEntry.create({
          data: { franchiseId: f.id, position: 0, title: 'x', runtimeMinutes: 100 },
        }),
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        db().franchiseEntry.create({
          data: { franchiseId: f.id, position: 1, title: 'x', runtimeMinutes: 400 },
        }),
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        db().catalogRevision.create({
          data: { itemId: f.id, version: 0, snapshot: {}, note: 'save', editorId: mod.id },
        }),
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        db().catalogRevision.create({
          data: { itemId: f.id, version: 1, snapshot: [], note: 'save', editorId: mod.id },
        }),
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        db().mediaAsset.create({
          data: {
            sha256: new Uint8Array(16),
            role: 'POSTER',
            width: 600,
            height: 900,
            variants: [],
            uploadedById: mod.id,
          },
        }),
      ),
    ).toBe('23514');
  });
});

async function openCampaign(goalCents = 30000) {
  const item = await makeItem({ kind: 'SERIES', status: 'ACTIVE', slot: 1 });
  const streamer = await makeUser({ role: 'STREAMER' });
  const now = new Date();
  return db().campaign.create({
    data: {
      itemId: item.id,
      goalCents,
      remainingCents: goalCents,
      deadlineAt: new Date(now.getTime() + 30 * 86_400_000),
      openedAt: now,
      openedById: streamer.id,
    },
  });
}

describe('Campaign money invariants (no overfunding)', () => {
  it('remaining = goal − raised − reserved ≥ 0', async () => {
    const c = await openCampaign(30000);
    const upd = (data: Record<string, unknown>) =>
      db().campaign.update({ where: { id: c.id }, data });
    expect(await sqlState(upd({ reservedCents: 500 }))).toBe('23514'); // remaining not adjusted
    expect(await sqlState(upd({ raisedCents: 31000, remainingCents: -1000 }))).toBe('23514'); // overfunded
    await expect(upd({ reservedCents: 500, remainingCents: 29500 })).resolves.toBeTruthy();
    // Funded requires raised = goal.
    expect(await sqlState(upd({ status: 'FUNDED', fundedAt: new Date() }))).toBe('23514');
  });

  it('the conditional decrement admits exactly what is left under concurrency', async () => {
    const c = await openCampaign(2000); // R$ 20
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        db().campaign.updateMany({
          where: { id: c.id, status: 'OPEN', remainingCents: { gte: 500 } },
          data: { remainingCents: { decrement: 500 }, reservedCents: { increment: 500 } },
        }),
      ),
    );
    expect(attempts.reduce((n, r) => n + r.count, 0)).toBe(4);
    const after = await db().campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toMatchObject({ remainingCents: 0, reservedCents: 2000, raisedCents: 0 });
  });
});

describe('Order kind-specific CHECKs', () => {
  async function ruleSet() {
    return db().priceRuleSet.create({
      data: {
        version: Math.floor(Math.random() * 1e9),
        config: {},
        configHash: new Uint8Array(32),
      },
    });
  }
  const common = () => ({
    publicCode: testPublicCode(),
    buyerKey: testBuyerKey(),
    contactEmail: 'guest@example.com',
    accessTokenHash: crypto.getRandomValues(new Uint8Array(32)),
    breakdown: [],
    clientRequestId: randomUUID(),
  });

  it('MOVIE orders need a rule set, runtime and reschedule counter, and no campaign', async () => {
    const m = await makeItem({ status: 'ACTIVE', slot: 1 });
    const rs = await ruleSet();
    const movie = {
      ...common(),
      kind: 'MOVIE' as const,
      itemId: m.id,
      subtotalCents: 2000,
      totalCents: 2000,
    };
    expect(
      await sqlState(
        db().order.create({ data: { ...movie, runtimeMinutes: 115, rescheduleCount: 0 } }),
      ),
    ).toBe('23514'); // no rule set
    expect(
      await sqlState(
        db().order.create({ data: { ...movie, ruleSetId: rs.id, rescheduleCount: 0 } }),
      ),
    ).toBe('23514'); // no runtime
    const c = await openCampaign();
    expect(
      await sqlState(
        db().order.create({
          data: {
            ...movie,
            ruleSetId: rs.id,
            runtimeMinutes: 115,
            rescheduleCount: 0,
            campaignId: c.id,
          },
        }),
      ),
    ).toBe('23514');
    await expect(
      db().order.create({
        data: { ...movie, ruleSetId: rs.id, runtimeMinutes: 115, rescheduleCount: 0 },
      }),
    ).resolves.toBeTruthy();
  });

  it('CONTRIBUTION orders: whole reais ≥ R$ 5, campaign set, no perks, no movie fields', async () => {
    const c = await openCampaign();
    const rs = await ruleSet();
    const base = { kind: 'CONTRIBUTION' as const, itemId: c.itemId, campaignId: c.id };
    const make = (extra: Record<string, unknown>) =>
      db().order.create({ data: { ...common(), ...base, ...extra } as never });
    expect(await sqlState(make({ subtotalCents: 499, totalCents: 499 }))).toBe('23514');
    expect(await sqlState(make({ subtotalCents: 550, totalCents: 550 }))).toBe('23514');
    expect(await sqlState(make({ subtotalCents: 1000, discountCents: 100, totalCents: 900 }))).toBe(
      '23514',
    );
    expect(await sqlState(make({ subtotalCents: 1000, totalCents: 1000, ruleSetId: rs.id }))).toBe(
      '23514',
    );
    expect(
      await sqlState(make({ subtotalCents: 1000, totalCents: 1000, rescheduleCount: 0 })),
    ).toBe('23514');
    expect(await sqlState(make({ subtotalCents: 1000, totalCents: 1000, campaignId: null }))).toBe(
      '23514',
    );
    await expect(make({ subtotalCents: 500, totalCents: 500 })).resolves.toBeTruthy();
  });

  it('one sponsor per movie: a second active MOVIE order for the same item is refused', async () => {
    const m = await makeItem({ status: 'ACTIVE', slot: 1 });
    const rs = await ruleSet();
    const movie = () => ({
      ...common(),
      kind: 'MOVIE' as const,
      itemId: m.id,
      ruleSetId: rs.id,
      runtimeMinutes: 115,
      rescheduleCount: 0,
      subtotalCents: 2000,
      totalCents: 2000,
    });
    const first = await db().order.create({ data: movie() });
    expect(await sqlState(db().order.create({ data: movie() }))).toBe('23505');
    await db().order.update({ where: { id: first.id }, data: { status: 'EXPIRED' } });
    await expect(db().order.create({ data: movie() })).resolves.toBeTruthy();
  });

  it('legal acceptance needs a user or an order', async () => {
    const doc = await db().legalDocument.create({
      data: {
        type: 'TERMS',
        version: randomUUID().slice(0, 10),
        sha256: new Uint8Array(32),
        publishedAt: new Date(),
      },
    });
    expect(await sqlState(db().legalAcceptance.create({ data: { documentId: doc.id } }))).toBe(
      '23514',
    );
  });
});
