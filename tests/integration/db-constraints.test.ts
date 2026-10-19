/**
 * Reviewed SQL (prisma/migrations/*_constraints) — the database itself enforces invariants
 * (10 §2 step 7): bad rating, double ACTIVE rule set, UPDATE on AuditLog → error, and more.
 */
import { describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { makeItem } from '../support/catalog';
import { makeUser, withAdmin } from '../support/db';
import { orderIdentity } from '../support/orders';

describe('CHECK constraints', () => {
  it('rejects a review rating outside 1..5 and empty/oversized bodies', async () => {
    const user = await makeUser();
    const t = await makeItem();
    for (const rating of [0, 6, -1]) {
      await expect(
        db().review.create({ data: { userId: user.id, itemId: t.id, rating, body: 'ok' } }),
      ).rejects.toThrow();
    }
    await expect(
      db().review.create({ data: { userId: user.id, itemId: t.id, rating: 3, body: '' } }),
    ).rejects.toThrow();
    await expect(
      db().review.create({
        data: { userId: user.id, itemId: t.id, rating: 3, body: 'x'.repeat(2001) },
      }),
    ).rejects.toThrow();
    await expect(
      db().review.create({ data: { userId: user.id, itemId: t.id, rating: 5, body: 'Ótimo!' } }),
    ).resolves.toBeTruthy();
  });

  it('enforces the canonical username format at the DB level', async () => {
    for (const username of ['Upper', 'ab', 'com espaço', 'açúcar', 'x'.repeat(21)]) {
      await expect(makeUser({ username })).rejects.toThrow();
    }
  });

  it('keeps order money consistent (total = subtotal − discount + queue jump)', async () => {
    const t = await makeItem();
    const rs = await db().priceRuleSet.create({
      data: {
        version: Math.floor(Math.random() * 1e6),
        config: {},
        configHash: new Uint8Array(32),
      },
    });
    const base = {
      ...orderIdentity(),
      kind: 'MOVIE' as const,
      itemId: t.id,
      runtimeMinutes: 120,
      rescheduleCount: 0,
      ruleSetId: rs.id,
    };
    await expect(
      db().order.create({
        data: {
          ...base,
          subtotalCents: 2000,
          discountCents: 0,
          queueJumpCents: 0,
          totalCents: 1999,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db().order.create({
        data: { ...base, contactEmail: 'Guest@Example.com', subtotalCents: 2000, totalCents: 2000 },
      }),
    ).rejects.toThrow();
    await expect(
      db().order.create({
        data: {
          ...base,
          subtotalCents: 2000,
          discountCents: 200,
          queueJumpCents: 1600,
          totalCents: 3400,
        },
      }),
    ).resolves.toBeTruthy();
  });

  it('validates voucher kinds and session capacity', async () => {
    await expect(
      db().voucher.create({ data: { code: 'PERCENT-01', kind: 'PERCENT', percentBps: 0 } }),
    ).rejects.toThrow();
    await expect(
      db().voucher.create({
        data: { code: 'FIXED-0001', kind: 'FIXED', amountCents: 500, percentBps: 10 },
      }),
    ).rejects.toThrow();
    await expect(
      db().voucher.create({ data: { code: 'lowercase1', kind: 'FIXED', amountCents: 500 } }),
    ).rejects.toThrow();
    await expect(
      db().voucher.create({ data: { code: 'FIXED-0002', kind: 'FIXED', amountCents: 500 } }),
    ).resolves.toBeTruthy();
    await expect(
      db().streamSession.create({
        data: { startsAt: new Date(), capacityMinutes: 60, bookedMinutes: 61 },
      }),
    ).rejects.toThrow();
  });
});

describe('"exactly one" partial unique indexes', () => {
  it('allows only one ACTIVE price rule set', async () => {
    const v = Math.floor(Math.random() * 1e6) + 1e6;
    await db().priceRuleSet.create({
      data: { version: v, status: 'ACTIVE', config: {}, configHash: new Uint8Array(32) },
    });
    await expect(
      db().priceRuleSet.create({
        data: { version: v + 1, status: 'ACTIVE', config: {}, configHash: new Uint8Array(32) },
      }),
    ).rejects.toThrow();
    // Any number of drafts/archived are fine.
    await db().priceRuleSet.create({
      data: { version: v + 2, status: 'DRAFT', config: {}, configHash: new Uint8Array(32) },
    });
    await db().priceRuleSet.create({
      data: { version: v + 3, status: 'DRAFT', config: {}, configHash: new Uint8Array(32) },
    });
  });

  it('allows only one current legal document per type', async () => {
    const mk = (version: string, isCurrent: boolean) =>
      db().legalDocument.create({
        data: {
          type: 'TERMS',
          version,
          sha256: new Uint8Array(32),
          publishedAt: new Date(),
          isCurrent,
        },
      });
    await mk('2026-10-01', true);
    await expect(mk('2026-10-02', true)).rejects.toThrow();
    await mk('2026-10-03', false);
  });
});

describe('AuditLog is append-only', () => {
  it('the app role (wf_app) cannot UPDATE, DELETE or TRUNCATE audit rows', async () => {
    await db().auditLog.create({ data: { action: 'test.append', targetType: 'Test' } });
    await expect(db().auditLog.updateMany({ data: { action: 'tampered' } })).rejects.toThrow(
      /permission denied|append-only/i,
    );
    await expect(db().auditLog.deleteMany({})).rejects.toThrow(/permission denied|append-only/i);
    await expect(db().$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow(
      /permission denied|append-only/i,
    );
  });

  it('even a superuser gets an error on UPDATE/DELETE/TRUNCATE (trigger)', async () => {
    await withAdmin(async (c) => {
      await expect(c.query(`UPDATE "AuditLog" SET action = 'x'`)).rejects.toThrow(/append-only/);
      await expect(c.query(`DELETE FROM "AuditLog"`)).rejects.toThrow(/append-only/);
      await expect(c.query(`TRUNCATE "AuditLog"`)).rejects.toThrow(/append-only/);
    });
  });

  it('refuses audit inserts under REPEATABLE READ (would fork the chain)', async () => {
    await withAdmin(async (c) => {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await expect(
        c.query(`INSERT INTO "AuditLog"(action, "targetType") VALUES ('x', 'y')`),
      ).rejects.toThrow(/READ COMMITTED/);
      await c.query('ROLLBACK');
    });
  });

  it('assigns time, chain position and hash itself (the app cannot backdate or forge)', async () => {
    const past = new Date('2020-01-01T00:00:00Z');
    const row = await db().auditLog.create({
      data: {
        action: 'test.forge',
        targetType: 'Test',
        at: past,
        hash: new Uint8Array(32),
        prevHash: new Uint8Array(32),
      },
    });
    expect(row.at.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(Buffer.from(row.hash!).equals(Buffer.alloc(32))).toBe(false);
  });
});

describe('timestamps', () => {
  it('app connections run in UTC (adapter-pg drops timestamptz offsets otherwise)', async () => {
    const [row] = await db().$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
    expect(row?.tz).toBe('UTC');
  });

  it('round-trips a timestamptz exactly, whatever the server default zone is', async () => {
    const at = new Date('2026-10-02T12:34:56.789Z');
    const s = await db().streamSession.create({ data: { startsAt: at, capacityMinutes: 60 } });
    const again = await db().streamSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(again.startsAt.toISOString()).toBe(at.toISOString());
    const now = Date.now();
    expect(Math.abs(again.createdAt.getTime() - now)).toBeLessThan(60_000);
  });
});
