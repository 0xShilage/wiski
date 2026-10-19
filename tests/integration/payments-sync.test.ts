/**
 * Worker side of payments (05 §6 steps 8–11, 13 §3 steps 9–10): payment.sync's verification and
 * forward-only state machine with its side effects, reconciliation, expiry, cancellation at the
 * provider, and the e-mail outbox. Mercado Pago is the local mock; the order is created through
 * the real checkout route.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as orders from '@/app/api/v1/orders/route';
import * as contributions from '@/app/api/v1/campaigns/[id]/contributions/route';
import { extendCampaign } from '@/server/catalog/campaigns';
import { db } from '@/server/db';
import { queueExtensionNotices, sendOutbox, sweepOutbox } from '@/server/email/outbox';
import { devOutbox } from '@/server/email/transport';
import { paymentsQueue } from '@/server/jobs/queues';
import { cancelPixAtProvider, expireDueOrders } from '@/server/orders/lifecycle';
import { MercadoPagoError } from '@/server/payments/mercadopago';
import { reconcile, syncMpOrder } from '@/server/payments/sync';
import { clearCatalog, makeCampaign, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { call, freshIp, req } from '../support/http';
import { checkoutHeaders, LEGAL, installPaymentsMock } from '../support/payments';

const mock = installPaymentsMock();

beforeEach(async () => {
  await clearCatalog();
  await paymentsQueue().obliterate({ force: true });
});

async function buyMovie(over: Record<string, unknown> = {}, slot = 1) {
  const movie = await makeItem({ status: 'ACTIVE', slot, runtimeMinutes: 115 });
  const res = await call(
    orders.POST,
    req('POST', '/api/v1/orders', {
      body: {
        itemId: movie.id,
        expectedTotalCents: 2000,
        contactEmail: `buyer-${randomUUID().slice(0, 8)}@example.com`,
        legal: LEGAL,
        ...over,
      },
      headers: checkoutHeaders(),
      ip: freshIp(),
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    order: { id: string; publicCode: string };
    accessToken: string;
  };
  const mp = mock.orderFor(body.order.id)!;
  return {
    movie,
    orderId: body.order.id,
    code: body.order.publicCode,
    token: body.accessToken,
    mpId: mp.id,
  };
}

async function contribute(campaignId: string, amountCents: number, email?: string) {
  const res = await call(
    contributions.POST,
    req('POST', `/api/v1/campaigns/${campaignId}/contributions`, {
      body: {
        amountCents,
        contactEmail: email ?? `fan-${randomUUID().slice(0, 8)}@example.com`,
        legal: LEGAL,
      },
      headers: checkoutHeaders(),
      ip: freshIp(),
    }),
    { id: campaignId },
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { order: { id: string } };
  return { orderId: body.order.id, mpId: mock.orderFor(body.order.id)!.id };
}

const state = async (orderId: string) =>
  db().order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payment: true, emails: true, queueJumpSlot: true, voucherRedemption: true },
  });

describe('approval (step 10 side effects, one transaction)', () => {
  it('movie: order PAID, movie SPONSORED, reservation cleared, receipt sent with the order link', async () => {
    const { movie, orderId, mpId, token, code } = await buyMovie();
    expect(await syncMpOrder(mpId, 'webhook')).toBe('unchanged'); // still waiting for the Pix
    mock.approve(mpId);
    expect(await syncMpOrder(mpId, 'webhook')).toBe('paid');

    const o = await state(orderId);
    expect(o.status).toBe('PAID');
    expect(o.paidAt).not.toBeNull();
    expect(o.payment).toMatchObject({
      status: 'APPROVED',
      providerStatus: 'processed',
      statusDetail: 'accredited',
    });
    const item = await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } });
    expect(item).toMatchObject({ status: 'SPONSORED', reservedOrderId: null, reservedUntil: null });
    const audit = await db().auditLog.findFirst({
      where: { action: 'order.paid', targetId: orderId },
    });
    expect(audit?.metadata).toEqual({ kind: 'MOVIE', totalCents: 2000, source: 'webhook' });

    // receipt: queued only now, sent once, token erased afterwards
    const receipt = o.emails.find((e) => e.template === 'ORDER_RECEIPT')!;
    expect(receipt.status).toBe('PENDING');
    expect(await sendOutbox(receipt.id)).toBe('sent');
    expect(await sendOutbox(receipt.id)).toBe('skipped');
    const sent = devOutbox().at(-1)!;
    expect(sent.subject).toBe(`Pagamento confirmado — pedido ${code}`);
    expect(sent.text).toContain(`/pedido/${code}#t=${token}`);
    expect(sent.to).toBe(o.contactEmail);
    expect(sent.idempotencyKey).toBe(receipt.id);
    const after = await db().emailOutbox.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(after).toMatchObject({ status: 'SENT', sealedToken: null });

    // the same approval again (duplicate webhook, reconcile) changes nothing
    expect(await syncMpOrder(mpId, 'reconcile')).toBe('unchanged');
  });

  it('no e-mail is ever sent before the approval', async () => {
    const { orderId } = await buyMovie();
    expect(await sweepOutbox()).toBe(0);
    const o = await state(orderId);
    expect(o.emails[0]!.status).toBe('HELD');
    expect(await sendOutbox(o.emails[0]!.id)).toBe('skipped');
    expect(devOutbox()).toHaveLength(0);
  });

  it('voucher and queue-jump slot become final with the payment', async () => {
    await db().voucher.deleteMany({});
    await db().voucher.create({ data: { code: 'DEZ-REAIS-1', kind: 'FIXED', amountCents: 1000 } });
    const { orderId, mpId } = await buyMovie({
      voucherCode: 'DEZ-REAIS-1',
      queueJumpTierId: 'prioridade',
      expectedTotalCents: 2600,
    });
    mock.approve(mpId);
    await syncMpOrder(mpId);
    const o = await state(orderId);
    expect(o.voucherRedemption?.status).toBe('CONSUMED');
    expect(o.queueJumpSlot?.confirmed).toBe(true);
  });

  it('contribution: reserved → raised; reaching the goal completes the campaign and notifies everyone', async () => {
    const { item, campaign } = await makeCampaign({ goalCents: 2000 });
    const a = await contribute(campaign.id, 1500, 'ana@example.com');
    const b = await contribute(campaign.id, 500, 'bia@example.com');
    mock.approve(a.mpId);
    expect(await syncMpOrder(a.mpId)).toBe('paid');
    let c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({
      raisedCents: 1500,
      reservedCents: 500,
      remainingCents: 0,
      supporterCount: 1,
      status: 'OPEN',
    });
    mock.approve(b.mpId);
    expect(await syncMpOrder(b.mpId)).toBe('paid');
    c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({
      raisedCents: 2000,
      reservedCents: 0,
      remainingCents: 0,
      supporterCount: 2,
      status: 'FUNDED',
    });
    expect(c.fundedAt).not.toBeNull();
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'FUNDED',
    );
    const notices = await db().emailOutbox.findMany({ where: { template: 'CAMPAIGN_FUNDED' } });
    expect(notices).toHaveLength(2);
    for (const n of notices) expect(await sendOutbox(n.id)).toBe('sent');
    expect(devOutbox().filter((m) => m.subject.startsWith('Meta atingida'))).toHaveLength(2);
  });
});

describe('verification (step 8): doubt → NEEDS_ATTENTION, never PAID', () => {
  it.each([
    [
      'amount changed',
      (o: { total_amount: string; transactions: { payments: { amount: string }[] } }) => {
        o.total_amount = '2.00';
        o.transactions.payments[0]!.amount = '2.00';
      },
      'AMOUNT_MISMATCH',
    ],
    [
      'another collector account',
      (o: { user_id: string }) => {
        o.user_id = '1138239348';
      },
      'ACCOUNT_MISMATCH',
    ],
    [
      'another application',
      (o: { integration_data: { application_id: string } }) => {
        o.integration_data.application_id = '999';
      },
      'ACCOUNT_MISMATCH',
    ],
    [
      'another external_reference',
      (o: { external_reference: string }) => {
        o.external_reference = randomUUID();
      },
      'ACCOUNT_MISMATCH',
    ],
  ] as const)('%s', async (_n, tamper, reason) => {
    const { movie, orderId, mpId } = await buyMovie();
    mock.approve(mpId);
    mock.mutate(mpId, tamper as never);
    expect(await syncMpOrder(mpId)).toBe('attention');
    const o = await state(orderId);
    expect(o).toMatchObject({ status: 'NEEDS_ATTENTION', attentionReason: reason });
    const item = await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } });
    expect(item.status).toBe('ACTIVE'); // not sold
    expect(item.reservedOrderId).toBeNull();
  });

  it('an order that is not ours is ignored', async () => {
    const { mpId } = await buyMovie();
    const foreign = mock.mutate(mpId, () => {});
    mock.orders.set('ORD01FOREIGNORDER0000000000', {
      ...structuredClone(foreign),
      id: 'ORD01FOREIGNORDER0000000000',
      external_reference: 'not-a-uuid',
    });
    expect(await syncMpOrder('ORD01FOREIGNORDER0000000000')).toBe('foreign');
  });
});

describe('ordering and concurrency (step 9)', () => {
  it('out of order: approved, then an older "pending" → stays approved', async () => {
    const { orderId, mpId } = await buyMovie();
    const t0 = new Date();
    mock.approve(mpId, new Date(t0.getTime() + 2000));
    expect(await syncMpOrder(mpId)).toBe('paid');
    mock.mutate(
      mpId,
      (o) => {
        o.status = 'action_required';
        o.status_detail = 'waiting_transfer';
      },
      new Date(t0.getTime() + 1000),
    );
    expect(await syncMpOrder(mpId)).toBe('stale');
    expect((await state(orderId)).status).toBe('PAID');
  });

  it('a payment never moves backwards even with a newer timestamp', async () => {
    const { orderId, mpId } = await buyMovie();
    mock.approve(mpId);
    await syncMpOrder(mpId);
    mock.mutate(mpId, (o) => {
      o.status = 'action_required';
    });
    expect(await syncMpOrder(mpId)).toBe('unchanged');
    expect((await state(orderId)).payment!.status).toBe('APPROVED');
  });

  it('10 concurrent syncs of the same approval → paid exactly once', async () => {
    const { campaign } = await makeCampaign({ goalCents: 5000 });
    const { orderId, mpId } = await contribute(campaign.id, 1000);
    mock.approve(mpId);
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => syncMpOrder(mpId)));
    expect(outcomes.filter((o) => o === 'paid')).toHaveLength(1);
    const c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({ raisedCents: 1000, reservedCents: 0, supporterCount: 1 });
    expect(await db().auditLog.count({ where: { action: 'order.paid', targetId: orderId } })).toBe(
      1,
    );
  });

  it('Mercado Pago unavailable → the job throws (BullMQ retries), nothing changes', async () => {
    const { orderId, mpId } = await buyMovie();
    mock.approve(mpId);
    mock.failNext(5, 503);
    await expect(syncMpOrder(mpId)).rejects.toBeInstanceOf(MercadoPagoError);
    expect((await state(orderId)).status).toBe('PENDING_PAYMENT');
  });
});

describe('expiry, cancellation, late approval (step 11, 13 D4)', () => {
  it('the sweep expires an unpaid order after Pix + grace, releases everything and cancels the Pix', async () => {
    const { campaign } = await makeCampaign({ goalCents: 5000 });
    const { orderId, mpId } = await contribute(campaign.id, 2000);
    expect(await expireDueOrders(new Date(Date.now() + 34 * 60_000))).toBe(0); // within grace
    expect(await expireDueOrders(new Date(Date.now() + 36 * 60_000))).toBe(1);
    const o = await state(orderId);
    expect(o.status).toBe('EXPIRED');
    expect(o.emails[0]).toMatchObject({ status: 'CANCELLED', sealedToken: null });
    const c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({ reservedCents: 0, remainingCents: 5000 });
    const jobs = await paymentsQueue().getJobs(['waiting', 'delayed']);
    expect(jobs.map((j) => j.name)).toContain('payment.cancel');
    expect(await cancelPixAtProvider(orderId)).toBe('cancelled');
    expect(mock.orders.get(mpId)!.status).toBe('canceled');
    expect((await state(orderId)).payment!.status).toBe('CANCELLED');
  });

  it('paid after we expired it → NEEDS_ATTENTION (LATE_APPROVAL); the movie stays with its new buyer', async () => {
    const first = await buyMovie();
    expect(await expireDueOrders(new Date(Date.now() + 36 * 60_000))).toBe(1);
    // the Pix was paid before our cancel reached Mercado Pago
    mock.approve(first.mpId);
    expect(await cancelPixAtProvider(first.orderId)).toBe('synced');
    expect(await syncMpOrder(first.mpId)).toBe('late-approval');
    const o = await state(first.orderId);
    expect(o).toMatchObject({ status: 'NEEDS_ATTENTION', attentionReason: 'LATE_APPROVAL' });
    expect(o.payment!.status).toBe('APPROVED');
    const item = await db().catalogItem.findUniqueOrThrow({ where: { id: first.movie.id } });
    expect(item.status).toBe('ACTIVE');
  });

  it('cancelled/expired at the provider while pending → our order closes and releases', async () => {
    const { movie, orderId, mpId } = await buyMovie();
    mock.mutate(mpId, (o) => {
      o.status = 'canceled';
      o.status_detail = 'expired';
    });
    expect(await syncMpOrder(mpId)).toBe('closed');
    expect((await state(orderId)).status).toBe('EXPIRED');
    expect(
      (await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).reservedOrderId,
    ).toBeNull();
  });

  it('refunded in the Mercado Pago panel → NEEDS_ATTENTION (REFUNDED_OUTSIDE); chargeback → CHARGEBACK', async () => {
    const a = await buyMovie({}, 1);
    mock.approve(a.mpId);
    await syncMpOrder(a.mpId);
    mock.mutate(a.mpId, (o) => {
      o.status_detail = 'refunded';
    });
    expect(await syncMpOrder(a.mpId)).toBe('attention');
    expect(await state(a.orderId)).toMatchObject({
      status: 'NEEDS_ATTENTION',
      attentionReason: 'REFUNDED_OUTSIDE',
    });

    const b = await buyMovie({}, 2);
    mock.approve(b.mpId);
    await syncMpOrder(b.mpId);
    mock.mutate(b.mpId, (o) => {
      o.status = 'charged_back';
      o.status_detail = 'settled';
    });
    expect(await syncMpOrder(b.mpId)).toBe('attention');
    expect(await state(b.orderId)).toMatchObject({
      status: 'NEEDS_ATTENTION',
      attentionReason: 'CHARGEBACK',
    });
  });
});

describe('reconciliation (every 2 min, nightly 48 h)', () => {
  it('queues a sync for pending payments not synced in the last 2 minutes', async () => {
    const { orderId, mpId } = await buyMovie();
    expect(await reconcile('recent')).toBe(0); // just synced at checkout
    await db().payment.update({
      where: { orderId },
      data: { lastSyncedAt: new Date(Date.now() - 3 * 60_000) },
    });
    expect(await reconcile('recent')).toBe(1);
    const jobs = await paymentsQueue().getJobs(['waiting']);
    expect(jobs.map((j) => j.data)).toContainEqual({ mpOrderId: mpId, source: 'reconcile' });
    expect(await reconcile('nightly')).toBeGreaterThanOrEqual(1);
  });
});

describe('campaign extension notices (11 §2.2)', () => {
  it('contributors with a paid contribution get one notice per extension', async () => {
    const { item, campaign } = await makeCampaign({ goalCents: 9000 });
    const paid = await contribute(campaign.id, 1000, 'ana@example.com');
    await contribute(campaign.id, 1000, 'pending@example.com'); // not paid → no notice
    mock.approve(paid.mpId);
    await syncMpOrder(paid.mpId);
    const streamer = await makeUser({ role: 'STREAMER' });
    const c = await extendCampaign({ actor: streamer, requestId: null }, item.id, 7);
    expect(await queueExtensionNotices(campaign.id, c.extensions)).toBe(1);
    expect(await queueExtensionNotices(campaign.id, c.extensions)).toBe(0); // idempotent
    const row = await db().emailOutbox.findFirstOrThrow({
      where: { template: 'CAMPAIGN_EXTENDED' },
    });
    expect(await sendOutbox(row.id)).toBe('sent');
    expect(devOutbox().at(-1)!.subject).toContain('Campanha prorrogada');
  });
});
