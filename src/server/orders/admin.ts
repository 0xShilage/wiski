import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { Role } from '@/generated/prisma/enums';
import type { PriceLine } from '@/lib/pricing/engine';
import { audit } from '../audit/audit';
import { db } from '../db';
import { pgErrorCode, PG } from '../db-errors';
import { rearmReceiptInTx } from '../email/outbox';
import { HttpError, Problems } from '../http/problem';
import { logger } from '../log';
import { MercadoPagoError, refundMpOrder } from '../payments/mercadopago';
import { creditContributionInTx, flushOutbox, syncMpOrder } from '../payments/sync';
import { confirmQueueJump } from '../pricing/queue-jump';
import { fitsRemaining } from './checkout';
import { newAccessToken } from './identity';
import { publishOrderState } from './lifecycle';
import { maskEmail } from './read';

/**
 * /admin/pedidos (13 §3 step 13): staff list/detail, moderation of the public texts, resolution
 * of NEEDS_ATTENTION (accept a late approval while there is still room — D4) and the exception
 * refund (STREAMER + Google step-up + passkey, enforced by the routes). Every action is audited.
 * Staff never see a full contact e-mail or Pix payload.
 */
type Actor = { id: string; role: Role };
type Ctx = { actor: Actor; requestId: string | null };

export const ADMIN_FILTERS = {
  atencao: { status: { in: ['NEEDS_ATTENTION', 'REFUND_PENDING'] } },
  moderacao: {
    OR: [{ displayNameStatus: 'PENDING' }, { messageStatus: 'PENDING' }],
    status: { notIn: ['EXPIRED', 'CANCELLED'] },
  },
  pendentes: { status: 'PENDING_PAYMENT' },
  pagos: { status: { in: ['PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED'] } },
  encerrados: { status: { in: ['EXPIRED', 'CANCELLED', 'REFUNDED'] } },
  todos: {},
} as const satisfies Record<string, Prisma.OrderWhereInput>;
export type AdminFilter = keyof typeof ADMIN_FILTERS;

export const AdminOrderProblems = {
  notResolvable: () =>
    new HttpError(409, 'ORDER_NOT_RESOLVABLE', 'Este pedido não está aguardando uma decisão.'),
  noRoom: (kind: 'MOVIE' | 'CONTRIBUTION') =>
    new HttpError(
      409,
      'ORDER_NO_ROOM',
      kind === 'MOVIE'
        ? 'O filme não está mais disponível (foi patrocinado ou reservado por outra pessoa). Faça o reembolso.'
        : 'A campanha não está aberta, ou este valor deixaria menos de R$ 5,00 faltando para a meta. Faça o reembolso.',
    ),
  notRefundable: () =>
    new HttpError(
      409,
      'ORDER_NOT_REFUNDABLE',
      'Só pedidos com pagamento aprovado e sem reembolso em andamento podem ser reembolsados.',
    ),
  nothingToModerate: () =>
    new HttpError(409, 'NOTHING_TO_MODERATE', 'Não há texto aguardando moderação neste campo.'),
  refundFailed: () =>
    new HttpError(
      502,
      'REFUND_FAILED',
      'O Mercado Pago não respondeu ao pedido de reembolso. Ele fica pendente: tente de novo em instantes (nunca é devolvido duas vezes).',
    ),
  refundRejected: (code: string | null) =>
    new HttpError(
      409,
      'REFUND_REJECTED',
      `O Mercado Pago recusou o reembolso${code ? ` (${code})` : ''}. O pedido voltou ao estado anterior; confira o motivo no painel do Mercado Pago.`,
    ),
};

const listSelect = {
  id: true,
  publicCode: true,
  kind: true,
  status: true,
  attentionReason: true,
  totalCents: true,
  createdAt: true,
  paidAt: true,
  guestDisplayName: true,
  displayNameStatus: true,
  messageStatus: true,
  item: { select: { title: true } },
  user: { select: { username: true } },
} satisfies Prisma.OrderSelect;

type ListRow = Prisma.OrderGetPayload<{ select: typeof listSelect }>;

function listView(o: ListRow) {
  return {
    publicCode: o.publicCode,
    kind: o.kind,
    status: o.status,
    attentionReason: o.attentionReason,
    totalCents: o.totalCents,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    title: o.item.title,
    buyer: o.user?.username ? `@${o.user.username}` : (o.guestDisplayName ?? 'Visitante'),
    toModerate: o.displayNameStatus === 'PENDING' || o.messageStatus === 'PENDING',
  };
}
export type AdminOrderRow = ReturnType<typeof listView>;

const CODE = /^WF-[0-9A-HJKMNP-TV-Z]{6}$/;

export async function listAdminOrders(opts: {
  filter: AdminFilter;
  q?: string | null;
  cursor?: string | null;
  take?: number;
}) {
  const take = Math.min(opts.take ?? 50, 100);
  const q = opts.q?.trim() ?? '';
  const where: Prisma.OrderWhereInput = {
    ...ADMIN_FILTERS[opts.filter],
    ...(q
      ? CODE.test(q.toUpperCase())
        ? { publicCode: q.toUpperCase() }
        : { item: { title: { contains: q.slice(0, 80), mode: 'insensitive' } } }
      : {}),
  };
  const rows = await db().order.findMany({
    where,
    select: listSelect,
    orderBy: { id: 'desc' }, // UUID v7: newest first
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > take;
  const page = more ? rows.slice(0, take) : rows;
  return {
    orders: page.map(listView),
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}

export async function adminCountsByFilter() {
  const [atencao, moderacao] = await Promise.all([
    db().order.count({ where: ADMIN_FILTERS.atencao }),
    db().order.count({ where: ADMIN_FILTERS.moderacao }),
  ]);
  return { atencao, moderacao };
}

async function loadByCode(code: string) {
  if (!CODE.test(code)) throw Problems.notFound();
  const order = await db().order.findUnique({
    where: { publicCode: code },
    include: {
      item: {
        select: { title: true, slug: true, kind: true, status: true, reservedOrderId: true },
      },
      campaign: { select: { id: true, status: true, remainingCents: true, deadlineAt: true } },
      user: { select: { username: true } },
      payment: { include: { refunds: { orderBy: { createdAt: 'desc' } } } },
    },
  });
  if (!order) throw Problems.notFound();
  return order;
}
type Loaded = Awaited<ReturnType<typeof loadByCode>>;

/** Can a late approval still be accepted? (the room it needs is free) */
function roomFor(o: Loaded): boolean {
  if (o.kind === 'MOVIE') {
    return (
      o.item.status === 'ACTIVE' && (!o.item.reservedOrderId || o.item.reservedOrderId === o.id)
    );
  }
  return (
    !!o.campaign &&
    o.campaign.status === 'OPEN' &&
    o.campaign.deadlineAt.getTime() > Date.now() &&
    fitsRemaining(o.totalCents, o.campaign.remainingCents)
  );
}

function detailView(o: Loaded, viewer: Actor) {
  const pay = o.payment;
  const approved = pay?.status === 'APPROVED';
  const refundOpen = pay?.refunds.some(
    (r) => r.status === 'REQUESTED' || r.status === 'IN_PROCESS',
  );
  // a refund whose Mercado Pago call failed (or never happened) can be sent again
  const refundRetry =
    o.status === 'REFUND_PENDING' && !!pay?.refunds.some((r) => r.status === 'REQUESTED');
  return {
    ...listView(o),
    lines: o.breakdown as unknown as PriceLine[],
    itemSlug: o.item.slug,
    itemKind: o.item.kind,
    contactEmail: maskEmail(o.contactEmail),
    displayName: o.guestDisplayName,
    displayNameStatus: o.displayNameStatus,
    message: o.sponsorMessage,
    messageStatus: o.messageStatus,
    showSponsorName: o.showSponsorName,
    queueJumpTierId: o.queueJumpTierId,
    expiredAt: o.cancelledAt?.toISOString() ?? null,
    payment: pay
      ? {
          status: pay.status,
          providerStatus: pay.providerStatus,
          statusDetail: pay.statusDetail,
          amountCents: pay.amountCents,
          approvedAt: pay.approvedAt?.toISOString() ?? null,
          expiresAt: pay.expiresAt.toISOString(),
          lastSyncedAt: pay.lastSyncedAt?.toISOString() ?? null,
        }
      : null,
    refunds: (pay?.refunds ?? []).map((r) => ({
      status: r.status,
      reason: r.reason,
      amountCents: r.amountCents,
      createdAt: r.createdAt.toISOString(),
    })),
    can: {
      moderate: true,
      accept:
        viewer.role === 'STREAMER' &&
        o.status === 'NEEDS_ATTENTION' &&
        o.attentionReason === 'LATE_APPROVAL' &&
        approved,
      acceptHasRoom: roomFor(o),
      refund:
        viewer.role === 'STREAMER' &&
        approved &&
        ((!refundOpen && (o.status === 'NEEDS_ATTENTION' || o.status === 'PAID')) || refundRetry),
      refundRetry: viewer.role === 'STREAMER' && refundRetry,
    },
  };
}
export type AdminOrderDetail = ReturnType<typeof detailView>;

export async function getAdminOrder(code: string, viewer: Actor): Promise<AdminOrderDetail> {
  return detailView(await loadByCode(code), viewer);
}

// ── moderation ──────────────────────────────────────────────────────────────────────────────

export async function moderateOrderText(
  ctx: Ctx,
  code: string,
  field: 'displayName' | 'message',
  decision: 'APPROVED' | 'REJECTED',
): Promise<AdminOrderDetail> {
  const o = await loadByCode(code);
  const column = field === 'displayName' ? 'displayNameStatus' : 'messageStatus';
  await db().$transaction(async (tx) => {
    const res = await tx.order.updateMany({
      where: { id: o.id, [column]: 'PENDING' },
      data: { [column]: decision },
    });
    if (res.count !== 1) throw AdminOrderProblems.nothingToModerate();
    await audit(
      {
        action: 'order.moderate',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Order',
        targetId: o.id,
        metadata: { field, decision },
      },
      tx,
    );
  });
  return getAdminOrder(code, ctx.actor);
}

// ── NEEDS_ATTENTION: accept a late approval (D4) ───────────────────────────────────────────

export async function acceptLateApproval(ctx: Ctx, code: string, now = new Date()) {
  const o = await loadByCode(code);
  if (
    o.status !== 'NEEDS_ATTENTION' ||
    o.attentionReason !== 'LATE_APPROVAL' ||
    o.payment?.status !== 'APPROVED'
  ) {
    throw AdminOrderProblems.notResolvable();
  }
  const access = newAccessToken();
  try {
    await db().$transaction(async (tx) => {
      const moved = await tx.order.updateMany({
        where: { id: o.id, status: 'NEEDS_ATTENTION', version: o.version },
        data: {
          status: 'PAID',
          paidAt: now,
          accessTokenHash: access.hash,
          version: { increment: 1 },
        },
      });
      if (moved.count !== 1) throw AdminOrderProblems.notResolvable();
      if (o.kind === 'MOVIE') {
        const took = await tx.catalogItem.updateMany({
          where: {
            id: o.itemId,
            status: 'ACTIVE',
            OR: [{ reservedOrderId: null }, { reservedOrderId: o.id }],
          },
          data: { status: 'SPONSORED', reservedUntil: null, reservedOrderId: null },
        });
        if (took.count !== 1) throw AdminOrderProblems.noRoom('MOVIE');
      } else {
        const ok =
          !!o.campaignId &&
          (await creditContributionInTx(tx, o.campaignId, o.itemId, o.totalCents, false, now));
        if (!ok) throw AdminOrderProblems.noRoom('CONTRIBUTION');
      }
      // The voucher use and a queue-jump slot were released at expiry and are not re-taken: the
      // buyer keeps the price they paid; the movie joins the regular queue (shown before accepting).
      await confirmQueueJump(tx, o.id);
      await rearmReceiptInTx(tx, o.id, access.token, now);
      await audit(
        {
          action: 'order.resolve',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'Order',
          targetId: o.id,
          metadata: { kind: o.kind, outcome: 'accepted' },
        },
        tx,
      );
      await audit(
        {
          action: 'order.paid',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'Order',
          targetId: o.id,
          metadata: { kind: o.kind, totalCents: o.totalCents, source: 'admin' },
        },
        tx,
      );
    });
  } catch (err) {
    // order_one_active_movie: another order already holds this movie
    if (pgErrorCode(err) === PG.uniqueViolation) throw AdminOrderProblems.noRoom(o.kind);
    throw err;
  }
  await publishOrderState(o.id);
  await flushOutbox(o.id);
  return getAdminOrder(code, ctx.actor);
}

// ── exception refund (04 §8) ─────────────────────────────────────────────────────────────────

/**
 * Mercado Pago refused the refund (a definite 4xx). Unless a verified read shows it refunded
 * after all, the refund is REJECTED and the order goes back to where it was (PAID if it had been
 * counted, NEEDS_ATTENTION otherwise) — never stuck in REFUND_PENDING.
 */
async function settleRejectedRefund(
  ctx: Ctx,
  o: Loaded,
  refundId: string,
  providerOrderId: string,
  mpCode: string | null,
): Promise<never> {
  await syncMpOrder(providerOrderId, 'order').catch(() => 'unchanged' as const);
  const r = await db().refund.findUniqueOrThrow({ where: { id: refundId } });
  if (r.status === 'APPROVED') throw AdminOrderProblems.refundFailed(); // it went through after all
  await db().$transaction(async (tx) => {
    const moved = await tx.refund.updateMany({
      where: { id: refundId, status: { in: ['REQUESTED', 'IN_PROCESS'] } },
      data: { status: 'REJECTED' },
    });
    if (moved.count !== 1) return;
    await tx.order.updateMany({
      where: { id: o.id, status: 'REFUND_PENDING' },
      data: { status: o.paidAt ? 'PAID' : 'NEEDS_ATTENTION', version: { increment: 1 } },
    });
    await audit(
      {
        action: 'order.refund',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Order',
        targetId: o.id,
        metadata: { kind: o.kind, amountCents: r.amountCents, reason: r.reason, state: 'rejected' },
      },
      tx,
    );
  });
  await publishOrderState(o.id);
  throw AdminOrderProblems.refundRejected(mpCode);
}

export type RefundReason = 'DUPLICATE_PAYMENT' | 'PROCESSING_ERROR' | 'LEGAL_REQUIREMENT';

/**
 * Total refund through Mercado Pago. Idempotent per Idempotency-Key (a double-click or a retry
 * returns the same refund), one open refund per payment. The Refund row is written first; the
 * provider call reuses the same key; the outcome is applied by the regular sync (which only
 * trusts a GET of the order).
 */
export async function requestRefund(
  ctx: Ctx,
  code: string,
  reason: RefundReason,
  idempotencyKey: string,
): Promise<AdminOrderDetail> {
  const o = await loadByCode(code);
  const pay = o.payment;
  if (!pay) throw AdminOrderProblems.notRefundable();

  // 1. The refund this request is about: the same key (double-click / retry), else an open one
  //    for this payment (a retry after a reload), else a new one.
  let refund = await db().refund.findUnique({ where: { idempotencyKey } });
  if (refund && refund.paymentId !== pay.id) {
    throw Problems.conflict(
      'IDEMPOTENCY_CONFLICT',
      'Chave de idempotência já usada em outro pedido.',
    );
  }
  refund ??= await db().refund.findFirst({
    where: { paymentId: pay.id, status: { in: ['REQUESTED', 'IN_PROCESS'] } },
  });
  if (!refund) {
    if (
      pay.status !== 'APPROVED' ||
      !pay.providerOrderId ||
      !pay.providerPaymentId ||
      (o.status !== 'NEEDS_ATTENTION' && o.status !== 'PAID')
    ) {
      throw AdminOrderProblems.notRefundable();
    }
    try {
      refund = await db().$transaction(async (tx) => {
        const r = await tx.refund.create({
          data: {
            paymentId: pay.id,
            idempotencyKey,
            amountCents: pay.amountCents,
            reason,
            requestedById: ctx.actor.id,
          },
        });
        const moved = await tx.order.updateMany({
          where: { id: o.id, version: o.version, status: { in: ['NEEDS_ATTENTION', 'PAID'] } },
          data: { status: 'REFUND_PENDING', version: { increment: 1 } },
        });
        if (moved.count !== 1) throw AdminOrderProblems.notRefundable();
        await audit(
          {
            action: 'order.refund',
            actor: ctx.actor,
            requestId: ctx.requestId,
            targetType: 'Order',
            targetId: o.id,
            metadata: { kind: o.kind, amountCents: pay.amountCents, reason, state: 'requested' },
          },
          tx,
        );
        return r;
      });
    } catch (err) {
      if (pgErrorCode(err) === PG.uniqueViolation) return getAdminOrder(code, ctx.actor); // raced
      throw err;
    }
    await publishOrderState(o.id);
  }

  // 2. Ask Mercado Pago — one caller at a time: a lease (REQUESTED → IN_PROCESS) decides who
  //    sends; the same key as the Refund row means even a repeat never refunds twice. A lease
  //    older than 2 minutes (a crash mid-call) can be taken again.
  if (pay.providerOrderId && pay.providerPaymentId) {
    const lease = await db().refund.updateMany({
      where: {
        id: refund.id,
        OR: [
          { status: 'REQUESTED' },
          { status: 'IN_PROCESS', updatedAt: { lt: new Date(Date.now() - 2 * 60_000) } },
        ],
      },
      data: { status: 'IN_PROCESS' },
    });
    if (lease.count === 1) {
      try {
        await refundMpOrder(pay.providerOrderId, pay.providerPaymentId, refund.idempotencyKey);
      } catch (err) {
        await db().refund.updateMany({
          where: { id: refund.id, status: 'IN_PROCESS' },
          data: { status: 'REQUESTED' },
        });
        logger.warn(
          {
            refundId: refund.id,
            err: err instanceof MercadoPagoError ? err.message : 'unknown',
          },
          'refund call failed',
        );
        if (err instanceof MercadoPagoError && err.kind === 'rejected') {
          await settleRejectedRefund(ctx, o, refund.id, pay.providerOrderId, err.mpCode);
        }
        // No answer: the refund stays REQUESTED (order REFUND_PENDING); a retry re-sends it with
        // the same key and reconcile checks the order every 2 minutes meanwhile.
        throw AdminOrderProblems.refundFailed();
      }
    }
  }

  // 3. Apply Mercado Pago's state now (a verified GET) instead of waiting for the webhook.
  if (pay.providerOrderId) {
    await syncMpOrder(pay.providerOrderId, 'order').catch((err: unknown) =>
      logger.warn({ err: err instanceof Error ? err.message : 'x' }, 'post-refund sync failed'),
    );
  }
  return getAdminOrder(code, ctx.actor);
}
