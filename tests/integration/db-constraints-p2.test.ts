/**
 * Phase 2 reviewed SQL (prisma/migrations/20261030120100_phase2_constraints): every CHECK, the
 * one-pending-order-per-buyer partial unique, and the ACTIVE rule set the migration publishes.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { canonicalJson, RULESET_REV3 } from '@/server/pricing/config';
import { sha256 } from '@/server/security/crypto';
import { clearCatalog, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { testBuyerKey, testPublicCode } from '../support/orders';

let movieId: string;
let ruleSetId: string;

beforeAll(async () => {
  await clearCatalog();
  movieId = (await makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot: 1 })).id;
  ruleSetId = (await db().priceRuleSet.findFirstOrThrow({ where: { status: 'ACTIVE' } })).id;
});

function order(over: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
  return db().order.create({
    data: {
      publicCode: testPublicCode(),
      kind: 'MOVIE',
      itemId: movieId,
      contactEmail: 'guest@example.com',
      buyerKey: testBuyerKey(),
      accessTokenHash: randomBytes(32),
      runtimeMinutes: 100,
      ruleSetId,
      rescheduleCount: 0,
      breakdown: [],
      subtotalCents: 2000,
      totalCents: 2000,
      status: 'CANCELLED',
      clientRequestId: randomUUID(),
      ...over,
    },
  });
}

describe('the ACTIVE rule set (rev 3)', () => {
  it('is exactly RULESET_REV3, and configHash = SHA-256 of its canonical JSON', async () => {
    const rs = await db().priceRuleSet.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    expect(rs.config).toEqual(RULESET_REV3);
    expect(Buffer.from(rs.configHash)).toEqual(sha256(canonicalJson(RULESET_REV3)));
    expect(canonicalJson(rs.config)).toBe(canonicalJson(RULESET_REV3));
  });
});

describe('Order CHECKs', () => {
  it('buyer key format', async () => {
    await expect(order({ buyerKey: 'e:not-a-hash' })).rejects.toThrow();
    await expect(order({ buyerKey: 'x' })).rejects.toThrow();
    await expect(order()).resolves.toBeTruthy();
  });

  it('a user order carries the user buyer key (unless claimed later)', async () => {
    const u = await makeUser();
    await expect(order({ userId: u.id })).rejects.toThrow();
    await expect(order({ userId: u.id, buyerKey: `u:${u.id}` })).resolves.toBeTruthy();
    await expect(order({ userId: u.id, claimedAt: new Date() })).resolves.toBeTruthy();
  });

  it('the IP key exists only while unpaid, and is a 16-char key', async () => {
    await expect(order({ status: 'CANCELLED', ipKey: 'AAAAAAAAAAAAAAAA' })).rejects.toThrow();
    await expect(order({ status: 'PENDING_PAYMENT', ipKey: 'short' })).rejects.toThrow();
    const o = await order({ status: 'PENDING_PAYMENT', ipKey: 'AAAAAAAAAAAAAAAA' });
    await expect(
      db().order.update({ where: { id: o.id }, data: { status: 'EXPIRED' } }),
    ).rejects.toThrow();
    await db().order.update({ where: { id: o.id }, data: { status: 'EXPIRED', ipKey: null } });
  });

  it('one unpaid order per buyer (partial unique)', async () => {
    const buyerKey = testBuyerKey();
    const m2 = await makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot: 2 });
    const m3 = await makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot: 3 });
    await order({ buyerKey, status: 'PENDING_PAYMENT', itemId: m2.id });
    await expect(order({ buyerKey, status: 'PENDING_PAYMENT', itemId: m3.id })).rejects.toThrow();
    await expect(order({ buyerKey, status: 'CANCELLED', itemId: m3.id })).resolves.toBeTruthy();
  });

  it('public code format (Crockford base32, no I L O U)', async () => {
    for (const code of ['WF-ABCDE', 'WF-ABCDEI', 'wf-abcdef', 'XX-ABCDEF', 'WF-ABCDEFG']) {
      await expect(order({ publicCode: code })).rejects.toThrow();
    }
  });

  it('texts: lengths and moderation status pairs', async () => {
    await expect(order({ sponsorMessage: 'oi' })).rejects.toThrow(); // no messageStatus
    await expect(
      order({ sponsorMessage: 'x'.repeat(141), messageStatus: 'PENDING' }),
    ).rejects.toThrow();
    await expect(order({ guestDisplayName: 'A', displayNameStatus: 'PENDING' })).rejects.toThrow();
    await expect(
      order({
        sponsorMessage: 'Bora!',
        messageStatus: 'PENDING',
        guestDisplayName: 'Ana',
        displayNameStatus: 'PENDING',
      }),
    ).resolves.toBeTruthy();
  });

  it('paid states need paidAt', async () => {
    await expect(order({ status: 'PAID' })).rejects.toThrow();
    await expect(order({ status: 'PAID', paidAt: new Date() })).resolves.toBeTruthy();
  });
});

describe('Payment / webhook / voucher CHECKs', () => {
  it('provider id digits only; APPROVED needs approvedAt', async () => {
    const o = await order();
    const base = {
      orderId: o.id,
      idempotencyKey: randomUUID(),
      amountCents: 2000,
      expiresAt: new Date(Date.now() + 60_000),
    };
    await expect(
      db().payment.create({ data: { ...base, providerPaymentId: 'abc' } }),
    ).rejects.toThrow();
    await expect(db().payment.create({ data: { ...base, status: 'APPROVED' } })).rejects.toThrow();
    await expect(
      db().payment.create({ data: { ...base, providerPaymentId: '123' } }),
    ).resolves.toBeTruthy();
  });

  it('webhook rows: numeric resource ids, bounded request ids', async () => {
    const base = { provider: 'MERCADO_PAGO' as const, topic: 'payment', signatureTs: new Date() };
    await expect(
      db().webhookEvent.create({ data: { ...base, requestId: randomUUID(), resourceId: 'x1' } }),
    ).rejects.toThrow();
    await expect(
      db().webhookEvent.create({ data: { ...base, requestId: 'r'.repeat(129), resourceId: '1' } }),
    ).rejects.toThrow();
    await expect(
      db().webhookEvent.create({ data: { ...base, requestId: randomUUID(), resourceId: '1' } }),
    ).resolves.toBeTruthy();
  });

  it('voucher redemptions: positive discount, buyer key format', async () => {
    const v = await db().voucher.create({
      data: {
        code: `CHECK-${randomUUID().slice(0, 6).toUpperCase()}`,
        kind: 'FIXED',
        amountCents: 500,
      },
    });
    const o1 = await order();
    const o2 = await order();
    await expect(
      db().voucherRedemption.create({
        data: { voucherId: v.id, buyerKey: testBuyerKey(), orderId: o1.id, discountCents: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      db().voucherRedemption.create({
        data: { voucherId: v.id, buyerKey: 'nope', orderId: o1.id, discountCents: 100 },
      }),
    ).rejects.toThrow();
    await expect(
      db().voucherRedemption.create({
        data: { voucherId: v.id, buyerKey: testBuyerKey(), orderId: o2.id, discountCents: 100 },
      }),
    ).resolves.toBeTruthy();
  });
});
