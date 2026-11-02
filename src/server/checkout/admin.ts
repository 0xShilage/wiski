import 'server-only';
import type { OrderStatus, Prisma, Role } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { db } from '../db';
import { pgErrorCode, PG } from '../db-errors';
import { HttpError, Problems } from '../http/problem';
import { publicMessage, publicSponsor, sponsorSelect } from '../live/sponsor';
import { refreshOverlays } from '../overlay/state';
import { publishOrder } from '../realtime/events';

/**
 * Orders in the dashboard (03 §5.6): the list, one order, approving the sponsor's message and a
 * guest's display name (Q10, Q16), and the streamer accepting an order that NEEDS_ATTENTION
 * (e.g. a Pix paid after its reservation expired) when the movie / campaign room is still there.
 * Contact e-mails are shown to the STREAMER only (support and refunds); moderators see the public
 * name.
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };
const PAGE = 30;

export const AdminOrderProblems = {
  changed: () =>
    new HttpError(
      409,
      'ORDER_CHANGED',
      'Este pedido mudou enquanto você olhava. Atualize a lista.',
    ),
  nothing: () => new HttpError(409, 'NOTHING_TO_REVIEW', 'Não há texto aguardando aprovação.'),
  notAcceptable: (detail: string) => new HttpError(409, 'CANNOT_ACCEPT', detail),
};

const listSelect = {
  id: true,
  publicCode: true,
  kind: true,
  status: true,
  totalCents: true,
  createdAt: true,
  paidAt: true,
  version: true,
  queueJumpTierId: true,
  contactEmail: true,
  userId: true,
  sessionId: true,
  rescheduleCount: true,
  breakdown: true,
  item: { select: { id: true, kind: true, title: true, slug: true } },
  session: { select: { id: true, startsAt: true, status: true } },
  payment: {
    select: { status: true, statusDetail: true, providerPaymentId: true, approvedAt: true },
  },
  ...sponsorSelect,
} satisfies Prisma.OrderSelect;

type Row = Prisma.OrderGetPayload<{ select: typeof listSelect }>;

function view(o: Row, role: Role) {
  return {
    id: o.id,
    code: o.publicCode,
    kind: o.kind,
    status: o.status,
    version: o.version,
    totalCents: o.totalCents,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    tier: o.queueJumpTierId,
    item: o.item,
    session: o.session ? { ...o.session, startsAt: o.session.startsAt.toISOString() } : null,
    rescheduleCount: o.rescheduleCount,
    buyer: o.user?.username ? `@${o.user.username}` : 'Convidado',
    email: role === 'STREAMER' ? o.contactEmail : null,
    publicName: publicSponsor(o),
    anonymous: !o.showSponsorName,
    guestDisplayName: o.guestDisplayName,
    displayNameStatus: o.displayNameStatus,
    sponsorMessage: o.sponsorMessage,
    messageStatus: o.messageStatus,
    shownMessage: publicMessage(o),
    payment: o.payment
      ? {
          status: o.payment.status,
          detail: o.payment.statusDetail,
          providerId: role === 'STREAMER' ? o.payment.providerPaymentId : null,
          approvedAt: o.payment.approvedAt?.toISOString() ?? null,
        }
      : null,
  };
}
export type AdminOrder = ReturnType<typeof view>;

export async function listOrders(
  role: Role,
  q: { status?: OrderStatus; pendingTexts?: boolean; code?: string; before?: string },
) {
  const where: Prisma.OrderWhereInput = {
    ...(q.status ? { status: q.status } : { status: { not: 'PENDING_PAYMENT' } }),
    ...(q.code ? { publicCode: q.code } : {}),
    ...(q.pendingTexts
      ? { OR: [{ messageStatus: 'PENDING' }, { displayNameStatus: 'PENDING' }] }
      : {}),
    ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
  };
  const rows = await db().order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: PAGE + 1,
    select: listSelect,
  });
  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  return {
    orders: shown.map((o) => view(o, role)),
    next: more ? shown.at(-1)!.createdAt.toISOString() : null,
  };
}

export async function orderCounts() {
  const [attention, texts, queue] = await Promise.all([
    db().order.count({ where: { status: 'NEEDS_ATTENTION' } }),
    db().order.count({
      where: {
        status: { notIn: ['PENDING_PAYMENT', 'EXPIRED', 'CANCELLED'] },
        OR: [{ messageStatus: 'PENDING' }, { displayNameStatus: 'PENDING' }],
      },
    }),
    db().order.count({ where: { kind: 'MOVIE', status: 'PAID' } }),
  ]);
  return { attention, texts, queue };
}

export async function getOrder(role: Role, id: string) {
  const o = await db().order.findUnique({ where: { id }, select: listSelect });
  if (!o) throw Problems.notFound();
  return view(o, role);
}

/** Approve or reject the sponsor message and/or the guest display name (moderators). */
export async function reviewTexts(
  ctx: Ctx,
  id: string,
  input: {
    expectedVersion: number;
    message?: 'APPROVED' | 'REJECTED';
    displayName?: 'APPROVED' | 'REJECTED';
  },
) {
  await db().$transaction(async (t) => {
    const o = await t.order.findUnique({ where: { id } });
    if (!o) throw Problems.notFound();
    if (o.version !== input.expectedVersion) throw AdminOrderProblems.changed();
    const data: Prisma.OrderUpdateManyMutationInput = {};
    if (input.message) {
      if (o.messageStatus !== 'PENDING') throw AdminOrderProblems.nothing();
      data.messageStatus = input.message;
    }
    if (input.displayName) {
      if (o.displayNameStatus !== 'PENDING') throw AdminOrderProblems.nothing();
      data.displayNameStatus = input.displayName;
    }
    if (!input.message && !input.displayName) throw AdminOrderProblems.nothing();
    // the version stays: approving a text doesn't change the order's state machine
    const res = await t.order.updateMany({
      where: {
        id,
        version: o.version,
        ...(input.message ? { messageStatus: 'PENDING' } : {}),
        ...(input.displayName ? { displayNameStatus: 'PENDING' } : {}),
      },
      data,
    });
    if (res.count !== 1) throw AdminOrderProblems.changed();
    await audit(
      {
        action: 'order.texts',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Order',
        targetId: id,
        metadata: {
          ...(input.message ? { message: input.message } : {}),
          ...(input.displayName ? { displayName: input.displayName } : {}),
        },
      },
      t,
    );
  });
  await refreshOverlays(['agora', 'fila']);
  return getOrder(ctx.actor.role, id);
}

/**
 * Streamer: an approved payment in NEEDS_ATTENTION becomes a normal sale (PAID) — but only if the
 * movie is still free (nobody else holds or bought it) or the campaign still has room. Payments
 * that failed verification are never accepted here: those are refunded.
 */
export async function acceptOrder(ctx: Ctx, id: string, expectedVersion: number, now = new Date()) {
  let code = '';
  try {
    await db().$transaction(
      async (t) => {
        const o = await t.order.findUnique({ where: { id }, include: { payment: true } });
        if (!o) throw Problems.notFound();
        if (o.status !== 'NEEDS_ATTENTION' || o.version !== expectedVersion) {
          throw AdminOrderProblems.changed();
        }
        const p = o.payment;
        if (!p || p.status !== 'APPROVED' || p.statusDetail?.startsWith('verification_failed')) {
          throw AdminOrderProblems.notAcceptable(
            'Só um Pix aprovado e conferido pode virar venda. Este precisa de reembolso.',
          );
        }
        code = o.publicCode;
        if (o.kind === 'MOVIE') {
          const res = await t.catalogItem.updateMany({
            where: {
              id: o.itemId,
              status: 'ACTIVE',
              OR: [{ reservedUntil: null }, { reservedUntil: { lt: now } }],
            },
            data: { status: 'SPONSORED', reservedUntil: null, reservedOrderId: null },
          });
          if (res.count !== 1) {
            throw AdminOrderProblems.notAcceptable(
              'O filme já foi reservado ou patrocinado por outra pessoa. Reembolse este pedido.',
            );
          }
        } else {
          const res = await t.campaign.updateMany({
            where: {
              id: o.campaignId!,
              status: { in: ['OPEN', 'PAUSED'] },
              remainingCents: { gte: o.totalCents },
            },
            data: {
              raisedCents: { increment: o.totalCents },
              remainingCents: { decrement: o.totalCents },
              supporterCount: { increment: 1 },
              version: { increment: 1 },
            },
          });
          if (res.count !== 1) {
            throw AdminOrderProblems.notAcceptable(
              'A campanha não tem mais espaço para este valor. Reembolse este pedido.',
            );
          }
          const c = await t.campaign.findUniqueOrThrow({ where: { id: o.campaignId! } });
          if (c.remainingCents === 0 && c.reservedCents === 0) {
            await t.campaign.update({
              where: { id: c.id },
              data: { status: 'FUNDED', fundedAt: now, version: { increment: 1 } },
            });
            await t.catalogItem.updateMany({
              where: { id: c.itemId, status: 'ACTIVE' },
              data: { status: 'FUNDED' },
            });
          }
        }
        const res = await t.order.updateMany({
          where: { id, status: 'NEEDS_ATTENTION', version: o.version },
          data: { status: 'PAID', paidAt: now, version: { increment: 1 } },
        });
        if (res.count !== 1) throw AdminOrderProblems.changed();
        await audit(
          {
            action: 'order.accept',
            actor: ctx.actor,
            requestId: ctx.requestId,
            targetType: 'Order',
            targetId: id,
            metadata: { kind: o.kind, totalCents: o.totalCents },
          },
          t,
        );
      },
      { isolationLevel: 'ReadCommitted', timeout: 10_000 },
    );
  } catch (err) {
    // the partial unique index "one active order per movie" is the last word
    if (pgErrorCode(err) === PG.uniqueViolation || (err as { code?: string }).code === 'P2002') {
      throw AdminOrderProblems.notAcceptable(
        'O filme já tem outro patrocinador. Reembolse este pedido.',
      );
    }
    throw err;
  }
  await publishOrder(id, { type: 'status', code, status: 'PAID', at: now.toISOString() });
  await refreshOverlays(['fila', 'meta']);
  return getOrder(ctx.actor.role, id);
}
