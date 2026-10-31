import 'server-only';
import type { RefundReason, Role } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { db } from '../db';
import { HttpError, Problems } from '../http/problem';
import { logger } from '../log';
import { refreshOverlays } from '../overlay/state';
import { publishOrder } from '../realtime/events';
import { MpError, refundPayment } from './mercadopago/client';

/**
 * The streamer's exception refund (04 §8): orders are non-refundable, except for a duplicate
 * payment, a processing error, or a refund counsel says is legally required. STREAMER + passkey +
 * Google step-up + Idempotency-Key, audited.
 *
 * Order of work: Mercado Pago first (idempotent: a retry with the same key returns the same
 * refund), then one transaction that moves the order to REFUND_PENDING and gives back what the
 * sale held (the movie returns to the catalogue, a contribution leaves the campaign). The payment
 * webhook then confirms it: REFUND_PENDING → REFUNDED (sync.ts). If our transaction failed after
 * MP refunded, that webhook lands the order in NEEDS_ATTENTION — a human sees it either way.
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

const REFUNDABLE = ['PAID', 'SCHEDULED', 'NEEDS_ATTENTION'] as const;

export const RefundProblems = {
  notRefundable: (detail: string) => new HttpError(409, 'NOT_REFUNDABLE', detail),
  provider: () =>
    new HttpError(
      503,
      'REFUND_PROVIDER_ERROR',
      'O Mercado Pago não confirmou o reembolso. Tente de novo em instantes (é seguro repetir).',
    ),
  changed: () =>
    new HttpError(409, 'ORDER_CHANGED', 'Este pedido mudou enquanto você olhava. Atualize a lista.'),
};

export async function requestRefund(
  ctx: Ctx,
  orderId: string,
  input: { reason: RefundReason; expectedVersion: number },
  idempotencyKey: string,
  now = new Date(),
) {
  const o = await db().order.findUnique({
    where: { id: orderId },
    include: { payment: true, campaign: true },
  });
  if (!o) throw Problems.notFound();

  // a replay of a request that already went through answers the same
  const prior = await db().refund.findUnique({ where: { idempotencyKey } });
  if (prior) {
    if (o.payment?.id !== prior.paymentId) throw RefundProblems.changed();
    if (o.status === 'REFUND_PENDING' || o.status === 'REFUNDED') {
      return { status: o.status, refundId: prior.id };
    }
  }

  if (!(REFUNDABLE as readonly string[]).includes(o.status) || o.version !== input.expectedVersion) {
    throw o.version !== input.expectedVersion
      ? RefundProblems.changed()
      : RefundProblems.notRefundable('Este pedido não pode ser reembolsado no estado atual.');
  }
  const p = o.payment;
  if (!p || p.status !== 'APPROVED' || !p.providerPaymentId) {
    throw RefundProblems.notRefundable('Só um Pix aprovado pode ser reembolsado.');
  }
  if (o.kind === 'CONTRIBUTION' && o.status !== 'NEEDS_ATTENTION') {
    if (!o.campaign || !['OPEN', 'PAUSED', 'FUNDED'].includes(o.campaign.status)) {
      throw RefundProblems.notRefundable(
        'A campanha já foi agendada ou assistida: esta contribuição não pode mais sair dela.',
      );
    }
  }

  const refund =
    prior ??
    (await db().refund.create({
      data: {
        paymentId: p.id,
        idempotencyKey,
        amountCents: p.amountCents,
        reason: input.reason,
        requestedById: ctx.actor.id,
      },
    }));

  let mp;
  try {
    mp = await refundPayment(p.providerPaymentId, refund.id);
  } catch (err) {
    logger.error(
      { alert: 'payments', orderId, kind: err instanceof MpError ? err.kind : 'unknown' },
      'refund request failed',
    );
    throw RefundProblems.provider();
  }

  await db().$transaction(
    async (t) => {
      const res = await t.order.updateMany({
        where: { id: o.id, version: o.version, status: o.status },
        data: {
          status: 'REFUND_PENDING',
          sessionId: null,
          scheduledAt: null,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) {
        logger.error({ alert: 'payments', orderId }, 'refund sent but the order changed meanwhile');
        throw RefundProblems.changed();
      }
      // give back what the sale held (NEEDS_ATTENTION orders hold nothing)
      if (o.status !== 'NEEDS_ATTENTION') {
        if (o.kind === 'MOVIE') {
          await t.catalogItem.updateMany({
            where: { id: o.itemId, status: 'SPONSORED' },
            data: { status: 'ACTIVE' },
          });
          if (o.sessionId && o.runtimeMinutes) {
            await t.streamSession.updateMany({
              where: { id: o.sessionId, bookedMinutes: { gte: o.runtimeMinutes } },
              data: { bookedMinutes: { decrement: o.runtimeMinutes } },
            });
          }
          await t.queueJumpSlot.deleteMany({ where: { orderId: o.id } });
        } else if (o.campaign) {
          const wasFunded = o.campaign.status === 'FUNDED';
          await t.campaign.update({
            where: { id: o.campaign.id },
            data: {
              raisedCents: { decrement: o.totalCents },
              remainingCents: { increment: o.totalCents },
              supporterCount: { decrement: 1 },
              ...(wasFunded ? { status: 'OPEN', fundedAt: null } : {}),
              version: { increment: 1 },
            },
          });
          if (wasFunded) {
            await t.catalogItem.updateMany({
              where: { id: o.campaign.itemId, status: 'FUNDED' },
              data: { status: 'ACTIVE' },
            });
          }
        }
      }
      await t.refund.update({
        where: { id: refund.id },
        data: {
          providerRefundId: String(mp.id),
          status: mp.status === 'approved' ? 'APPROVED' : mp.status === 'rejected' ? 'REJECTED' : 'IN_PROCESS',
        },
      });
      await audit(
        {
          action: 'refund.request',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'Order',
          targetId: o.id,
          metadata: { reason: input.reason, amountCents: p.amountCents, from: o.status },
        },
        t,
      );
    },
    { isolationLevel: 'ReadCommitted', timeout: 10_000 },
  );
  await publishOrder(o.id, {
    type: 'status',
    code: o.publicCode,
    status: 'REFUND_PENDING',
    at: now.toISOString(),
  });
  await refreshOverlays(['fila', 'meta']);
  return { status: 'REFUND_PENDING' as const, refundId: refund.id };
}
