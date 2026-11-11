/** Campaign seat map (2026-11-11): "seu lugar" only for a paid contribution of your own. */
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { hasContributed } from '@/server/campaigns/seat';
import { db } from '@/server/db';
import { clearCatalog } from '../support/catalog';
import { openCampaignFor } from '../support/checkout';
import { as } from '../support/live';
import { testPublicCode } from '../support/orders';

beforeEach(async () => {
  await clearCatalog();
});

async function contribution(
  userId: string | null,
  campaignId: string,
  itemId: string,
  status: 'PAID' | 'REFUNDED' | 'PENDING_PAYMENT' = 'PAID',
) {
  return db().order.create({
    data: {
      publicCode: testPublicCode(),
      kind: 'CONTRIBUTION',
      itemId,
      campaignId,
      userId,
      contactEmail: `c-${randomUUID().slice(0, 8)}@example.com`,
      buyerKey: userId ? `u:${userId}` : `e:${randomBytes(32).toString('hex')}`,
      accessTokenHash: randomBytes(32),
      breakdown: [],
      subtotalCents: 1000,
      queueJumpCents: 0,
      totalCents: 1000,
      status,
      paidAt: status === 'PENDING_PAYMENT' ? null : new Date(),
      clientRequestId: randomUUID(),
    },
  });
}

describe('hasContributed', () => {
  it('true only for your own paid contribution to that campaign', async () => {
    const me = await as('USER');
    const other = await as('USER');
    const { item, campaign } = await openCampaignFor(50_000);
    const { item: item2, campaign: elsewhere } = await openCampaignFor(50_000);

    expect(await hasContributed(me.user.id, campaign.id)).toBe(false);
    await contribution(other.user.id, campaign.id, item.id); // someone else's
    await contribution(me.user.id, elsewhere.id, item2.id); // another campaign
    await contribution(me.user.id, campaign.id, item.id, 'PENDING_PAYMENT'); // not paid yet
    expect(await hasContributed(me.user.id, campaign.id)).toBe(false);

    const paid = await contribution(me.user.id, campaign.id, item.id);
    expect(await hasContributed(me.user.id, campaign.id)).toBe(true);
    await db().order.update({ where: { id: paid.id }, data: { status: 'REFUNDED' } });
    expect(await hasContributed(me.user.id, campaign.id)).toBe(false);
  });
});
