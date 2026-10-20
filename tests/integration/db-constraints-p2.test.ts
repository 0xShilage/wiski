/**
 * Phase 2 reviewed SQL (prisma/migrations/*_p2_constraints): invariants no service bug can break.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { clearCatalog, makeCampaign, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { orderIdentity, testBuyerKey } from '../support/orders';

async function sqlState(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as {
      meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
      code?: string;
    };
    return err.meta?.driverAdapterError?.cause?.originalCode ?? err.code ?? 'unknown';
  }
}

let campaign: Awaited<ReturnType<typeof makeCampaign>>['campaign'];
beforeEach(async () => {
  await clearCatalog();
  ({ campaign } = await makeCampaign());
});

async function contribution(over: Record<string, unknown> = {}) {
  return db().order.create({
    data: {
      ...orderIdentity(),
      kind: 'CONTRIBUTION',
      itemId: campaign.itemId,
      campaignId: campaign.id,
      subtotalCents: 500,
      totalCents: 500,
      ...over,
    } as never,
  });
}

describe('buyer keys', () => {
  it('must be "u:<uuid>" or "e:<64 hex>" — never an e-mail', async () => {
    expect(await sqlState(contribution({ buyerKey: 'guest@example.com' }))).toBe('23514');
    expect(await sqlState(contribution({ buyerKey: 'e:abc' }))).toBe('23514');
    await expect(contribution({ buyerKey: testBuyerKey() })).resolves.toBeTruthy();
  });

  it("a user's order carries that user's key unless it was claimed later", async () => {
    const u = await makeUser();
    expect(await sqlState(contribution({ userId: u.id, buyerKey: testBuyerKey() }))).toBe('23514');
    await expect(contribution({ userId: u.id, buyerKey: `u:${u.id}` })).resolves.toBeTruthy();
    await expect(
      contribution({ userId: u.id, buyerKey: testBuyerKey(), claimedAt: new Date() }),
    ).resolves.toBeTruthy();
  });

  it('one unpaid order per buyer (partial unique); paid ones do not count', async () => {
    const key = testBuyerKey();
    const first = await contribution({ buyerKey: key });
    expect(await sqlState(contribution({ buyerKey: key }))).toBe('23505');
    await db().order.update({
      where: { id: first.id },
      data: { status: 'PAID', paidAt: new Date() },
    });
    await expect(contribution({ buyerKey: key })).resolves.toBeTruthy();
  });
});

describe('order states', () => {
  it('NEEDS_ATTENTION always says why; paid states have paidAt; codes are Crockford', async () => {
    const o = await contribution();
    expect(
      await sqlState(
        db().order.update({ where: { id: o.id }, data: { status: 'NEEDS_ATTENTION' } }),
      ),
    ).toBe('23514');
    await expect(
      db().order.update({
        where: { id: o.id },
        data: { status: 'NEEDS_ATTENTION', attentionReason: 'LATE_APPROVAL' },
      }),
    ).resolves.toBeTruthy();
    expect(
      await sqlState(db().order.update({ where: { id: o.id }, data: { status: 'PAID' } })),
    ).toBe('23514');
    expect(await sqlState(contribution({ publicCode: 'WF-ILOU00' }))).toBe('23514');
  });
});

describe('payments and outbox', () => {
  it('provider strings stay short codes', async () => {
    const o = await contribution();
    const pay = (data: Record<string, unknown>) =>
      db().payment.create({
        data: {
          orderId: o.id,
          idempotencyKey: randomUUID(),
          amountCents: 500,
          expiresAt: new Date(),
          ...data,
        },
      });
    expect(await sqlState(pay({ providerOrderId: 'ORD 01' }))).toBe('23514');
    expect(await sqlState(pay({ providerStatus: 'x'.repeat(41) }))).toBe('23514');
    await expect(
      pay({ providerOrderId: 'ORD01ABC', providerPaymentId: 'PAY01ABC' }),
    ).resolves.toBeTruthy();
  });

  it('a final outbox row never keeps the sealed token; SENT has a time; notices name a campaign', async () => {
    const o = await contribution();
    const row = (data: Record<string, unknown>) =>
      db().emailOutbox.create({
        data: {
          template: 'ORDER_RECEIPT',
          orderId: o.id,
          dedupeKey: `t:${randomUUID()}`,
          ...data,
        } as never,
      });
    expect(await sqlState(row({ status: 'SENT', sealedToken: 'v1.x.y', sentAt: new Date() }))).toBe(
      '23514',
    );
    expect(await sqlState(row({ status: 'SENT' }))).toBe('23514');
    expect(await sqlState(row({ template: 'CAMPAIGN_FUNDED' }))).toBe('23514'); // no campaignId
    await expect(row({ status: 'HELD', sealedToken: 'v1.x.y' })).resolves.toBeTruthy();
  });
});

describe('queue jump per-tier cap', () => {
  it('(day, tierId, tierIndex) is unique; uncapped tiers (null index) are not limited by it', async () => {
    const make = async (tierIndex: number | null, i: number) => {
      const m = await makeItem({ status: 'ACTIVE', slot: 10 + i });
      const rs = await db().priceRuleSet.create({
        data: {
          version: 1000 + i + Math.floor(Math.random() * 1e6),
          config: {},
          configHash: new Uint8Array(32),
        },
      });
      const order = await db().order.create({
        data: {
          ...orderIdentity(),
          kind: 'MOVIE',
          itemId: m.id,
          ruleSetId: rs.id,
          runtimeMinutes: 100,
          rescheduleCount: 0,
          subtotalCents: 2000,
          totalCents: 2000,
        },
      });
      return db().queueJumpSlot.create({
        data: {
          orderId: order.id,
          day: new Date('2026-10-19T00:00:00Z'),
          tierId: tierIndex === null ? 'prioridade' : 'topo',
          dayIndex: i,
          isoWeek: '2026-W43',
          weekIndex: i,
          tierIndex,
          multiplierBps: 8000,
          expiresAt: new Date(),
        },
      });
    };
    await make(0, 1);
    expect(await sqlState(make(0, 2))).toBe('23505');
    await make(null, 3);
    await expect(make(null, 4)).resolves.toBeTruthy();
    expect(await sqlState(make(-1, 5))).toBe('23514');
  });
});
