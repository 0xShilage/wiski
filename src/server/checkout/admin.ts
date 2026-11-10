import 'server-only';
import type { OrderStatus, Prisma, Role } from '@/generated/prisma/client';
import { movieListPriceCents } from '@/lib/catalog/pricing';
import { audit } from '../audit/audit';
import { campaignState } from '../catalog/campaigns';
import { db } from '../db';
import { pgErrorCode, PG } from '../db-errors';
import { HttpError, Problems } from '../http/problem';
import { publicMessage, publicSponsor, sponsorSelect } from '../live/sponsor';
import { announcePaidOrder, refreshOverlays } from '../overlay/state';
import { priceMovie } from '../pricing/engine';
import { type ActiveRuleSet, activeRuleSet } from '../pricing/ruleset';
import { publishCampaign, publishOrder } from '../realtime/events';
import { sha256Bytes } from '../security/crypto';
import { buyerKeyFor, newAccessToken, newPublicCode, normaliseEmail } from './buyer';
import { uniqueViolation } from './orders';

/**
 * Orders in the dashboard (03 §5.6): the list, one order, hiding or showing the sponsor's message
 * and a guest's public name (Q10, Q16), and the streamer accepting an order that NEEDS_ATTENTION
 * (e.g. a Pix paid after its reservation expired) when the movie / campaign room is still there.
 * Contact e-mails are shown to staff (support; 2026-11-08); both see the public
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
  nothing: () =>
    new HttpError(409, 'NOTHING_TO_REVIEW', 'Este texto já está assim. Atualize a lista.'),
  notAcceptable: (detail: string) => new HttpError(409, 'CANNOT_ACCEPT', detail),
};

const listSelect = {
  id: true,
  publicCode: true,
  kind: true,
  status: true,
  source: true,
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

function view(o: Row) {
  return {
    id: o.id,
    code: o.publicCode,
    kind: o.kind,
    status: o.status,
    /** "Já pago": registered by the streamer, no Pix on the site */
    manual: o.source === 'MANUAL',
    version: o.version,
    totalCents: o.totalCents,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    tier: o.queueJumpTierId,
    item: o.item,
    session: o.session ? { ...o.session, startsAt: o.session.startsAt.toISOString() } : null,
    rescheduleCount: o.rescheduleCount,
    buyer:
      o.source === 'MANUAL'
        ? 'Pago fora do site'
        : o.user?.username
          ? `@${o.user.username}`
          : 'Convidado',
    email: o.source !== 'MANUAL' ? o.contactEmail : null,
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
          providerId: o.payment.providerPaymentId,
          approvedAt: o.payment.approvedAt?.toISOString() ?? null,
        }
      : null,
  };
}
export type AdminOrder = ReturnType<typeof view>;

export async function listOrders(
  role: Role,
  q: { status?: OrderStatus; withTexts?: boolean; code?: string; before?: string },
) {
  const where: Prisma.OrderWhereInput = {
    ...(q.status ? { status: q.status } : { status: { not: 'PENDING_PAYMENT' } }),
    ...(q.code ? { publicCode: q.code } : {}),
    // every order that carries a text, shown or hidden: nothing waits for approval (2026-11-04)
    ...(q.withTexts
      ? { OR: [{ sponsorMessage: { not: null } }, { guestDisplayName: { not: null } }] }
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
    orders: shown.map((o) => view(o)),
    next: more ? shown.at(-1)!.createdAt.toISOString() : null,
  };
}

export async function orderCounts() {
  const [attention, queue] = await Promise.all([
    db().order.count({ where: { status: 'NEEDS_ATTENTION' } }),
    db().order.count({ where: { kind: 'MOVIE', status: 'PAID' } }),
  ]);
  return { attention, queue };
}

export async function getOrder(role: Role, id: string) {
  const o = await db().order.findUnique({ where: { id }, select: listSelect });
  if (!o) throw Problems.notFound();
  return view(o);
}

/**
 * Moderators: show or hide the sponsor message and the guest's public name. Both texts are live
 * from the moment the order is created (message 2026-11-03, name 2026-11-04), so this is only
 * hiding (REJECTED) and showing again (APPROVED) — never a queue anyone has to work through. The
 * change is a compare-and-set on the status the moderator saw, so two moderators can't fight.
 */
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
      if (!o.sponsorMessage || !o.messageStatus || o.messageStatus === input.message)
        throw AdminOrderProblems.nothing();
      data.messageStatus = input.message;
    }
    if (input.displayName) {
      if (!o.guestDisplayName || !o.displayNameStatus || o.displayNameStatus === input.displayName)
        throw AdminOrderProblems.nothing();
      data.displayNameStatus = input.displayName;
    }
    if (!input.message && !input.displayName) throw AdminOrderProblems.nothing();
    // the version stays: showing or hiding a text doesn't change the order's state machine
    const res = await t.order.updateMany({
      where: {
        id,
        version: o.version,
        ...(input.message && o.messageStatus ? { messageStatus: o.messageStatus } : {}),
        ...(input.displayName && o.displayNameStatus
          ? { displayNameStatus: o.displayNameStatus }
          : {}),
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
  // accepted as a sale: "Novo patrocínio" on stream and in chat (2026-11-09)
  await announcePaidOrder(id);
  return getOrder(ctx.actor.role, id);
}

// ── "Já pago" (2026-11-02) ──────────────────────────────────────────────────────

/**
 * The streamer registers a payment received outside the site (a Pix to her own key, cash, a
 * deal): the title enters the queue exactly like a site sale — a movie becomes SPONSORED with a
 * PAID order (the queue), a contribution is added to its campaign (FUNDED when it completes) —
 * but the order is `source = MANUAL`: no Payment row, no Mercado Pago call, no e-mail, no stream
 * alert, no order link (its access token is never shown). It cannot be refunded through the site;
 * a mistake is undone with `undoManualPayment`.
 */
export type ManualCandidate = {
  itemId: string;
  kind: 'MOVIE' | 'SERIES' | 'FRANCHISE';
  title: string;
  slot: number | null;
  /** movie: its price (manual or by runtime); campaign: what is left to raise */
  defaultCents: number;
  /** campaigns: the most a manual contribution can add (what is not raised or held) */
  maxCents: number;
};

export const MANUAL_MAX_CENTS = 1_000_000; // R$ 10.000,00

export const ManualProblems = {
  unavailable: (detail: string) => new HttpError(409, 'CANNOT_REGISTER', detail),
  duplicate: () =>
    new HttpError(409, 'ALREADY_REGISTERED', 'Este pagamento já foi registrado. Atualize a lista.'),
  noPrices: () =>
    new HttpError(
      409,
      'NO_PRICES',
      'Cadastre a tabela de preços antes de registrar um filme pago.',
    ),
};

function movieDefaultCents(
  config: ActiveRuleSet['config'] | null,
  item: { runtimeMinutes: number; manualPriceCents: number | null },
  now: Date,
): number {
  if (config) {
    try {
      return priceMovie(
        config,
        { runtimeMinutes: item.runtimeMinutes, baseOverrideCents: item.manualPriceCents },
        { perk: 'NONE', voucher: null, now },
      ).totalCents;
    } catch {
      /* fall through to the list price */
    }
  }
  return movieListPriceCents(item.runtimeMinutes, item.manualPriceCents);
}

/** What can be registered as paid now: free live movies and open/paused campaigns with room. */
export async function manualCandidates(now = new Date()): Promise<ManualCandidate[]> {
  const rs = await activeRuleSet();
  const [movies, campaigns] = await Promise.all([
    db().catalogItem.findMany({
      where: {
        kind: 'MOVIE',
        status: 'ACTIVE',
        OR: [{ reservedUntil: null }, { reservedUntil: { lt: now } }],
      },
      orderBy: { slot: 'asc' },
      select: { id: true, title: true, slot: true, runtimeMinutes: true, manualPriceCents: true },
    }),
    db().campaign.findMany({
      where: {
        status: { in: ['OPEN', 'PAUSED'] },
        remainingCents: { gt: 0 },
        item: { status: 'ACTIVE' },
      },
      select: {
        remainingCents: true,
        item: { select: { id: true, kind: true, title: true, slot: true } },
      },
    }),
  ]);
  const order = { MOVIE: 0, SERIES: 1, FRANCHISE: 2 } as const;
  return [
    ...movies.map((m) => ({
      itemId: m.id,
      kind: 'MOVIE' as const,
      title: m.title,
      slot: m.slot,
      defaultCents: movieDefaultCents(rs?.config ?? null, m, now),
      maxCents: MANUAL_MAX_CENTS,
    })),
    ...campaigns
      .map((c) => ({
        itemId: c.item.id,
        kind: c.item.kind,
        title: c.item.title,
        slot: c.item.slot,
        defaultCents: c.remainingCents,
        maxCents: c.remainingCents,
      }))
      .sort((a, b) => order[a.kind] - order[b.kind] || (a.slot ?? 99) - (b.slot ?? 99)),
  ];
}

export async function registerManualPayment(
  ctx: Ctx,
  input: {
    itemId: string;
    amountCents?: number | undefined;
    sponsorName?: string | undefined;
    message?: string | undefined;
    idempotencyKey: string;
  },
  now = new Date(),
) {
  const actor = await db().user.findUniqueOrThrow({
    where: { id: ctx.actor.id },
    select: { email: true },
  });
  const contactEmail = normaliseEmail(actor.email);
  const item = await db().catalogItem.findUnique({
    where: { id: input.itemId },
    include: { campaign: true },
  });
  if (!item) throw ManualProblems.unavailable('Título não encontrado. Atualize a lista.');
  const rs = item.kind === 'MOVIE' ? await activeRuleSet() : null;
  if (item.kind === 'MOVIE' && !rs) throw ManualProblems.noPrices();

  const amount =
    input.amountCents ??
    (item.kind === 'MOVIE'
      ? movieDefaultCents(rs!.config, item, now)
      : (item.campaign?.remainingCents ?? 0));
  if (amount < 1 || amount > MANUAL_MAX_CENTS) {
    throw Problems.validation([{ path: 'amountCents', message: 'Valor inválido.' }]);
  }
  const lines = [
    {
      key: item.kind === 'MOVIE' ? 'base' : 'contribution',
      label: item.kind === 'MOVIE' ? 'Filme' : 'Contribuição',
      cents: amount,
    },
    { key: 'manual', label: 'Pago fora do site', cents: null },
    { key: 'total', label: 'Total', cents: amount },
  ];

  let orderId = '';
  let code = '';
  for (let attempt = 0; ; attempt++) {
    try {
      await db().$transaction(
        async (t) => {
          if (item.kind === 'MOVIE') {
            const res = await t.catalogItem.updateMany({
              where: {
                id: item.id,
                status: 'ACTIVE',
                OR: [{ reservedUntil: null }, { reservedUntil: { lt: now } }],
              },
              data: { status: 'SPONSORED', reservedUntil: null, reservedOrderId: null },
            });
            if (res.count !== 1) {
              throw ManualProblems.unavailable(
                'Este filme já está reservado ou patrocinado. Atualize a lista.',
              );
            }
          } else {
            const c = item.campaign;
            if (!c) throw ManualProblems.unavailable('Esta campanha ainda não foi aberta.');
            const res = await t.campaign.updateMany({
              where: {
                id: c.id,
                status: { in: ['OPEN', 'PAUSED'] },
                remainingCents: { gte: amount },
              },
              data: {
                raisedCents: { increment: amount },
                remainingCents: { decrement: amount },
                supporterCount: { increment: 1 },
                version: { increment: 1 },
              },
            });
            if (res.count !== 1) {
              throw ManualProblems.unavailable(
                'A campanha não tem espaço para este valor (ou já fechou). Atualize a lista.',
              );
            }
            const fresh = await t.campaign.findUniqueOrThrow({ where: { id: c.id } });
            if (fresh.remainingCents === 0 && fresh.reservedCents === 0) {
              await t.campaign.update({
                where: { id: c.id },
                data: { status: 'FUNDED', fundedAt: now, version: { increment: 1 } },
              });
              await t.catalogItem.updateMany({
                where: { id: item.id, status: 'ACTIVE' },
                data: { status: 'FUNDED' },
              });
            }
          }
          const order = await t.order.create({
            data: {
              publicCode: newPublicCode(),
              kind: item.kind === 'MOVIE' ? 'MOVIE' : 'CONTRIBUTION',
              source: 'MANUAL',
              itemId: item.id,
              userId: null,
              contactEmail,
              buyerKey: buyerKeyFor(null, contactEmail),
              ipKey: null,
              accessTokenHash: sha256Bytes(newAccessToken()), // never shown: no order link
              ...(item.kind === 'MOVIE'
                ? { runtimeMinutes: item.runtimeMinutes, ruleSetId: rs!.id, rescheduleCount: 0 }
                : { campaignId: item.campaign!.id }),
              breakdown: lines,
              subtotalCents: amount,
              totalCents: amount,
              // the streamer typed these herself: approved as written
              ...(input.sponsorName
                ? { guestDisplayName: input.sponsorName, displayNameStatus: 'APPROVED' as const }
                : {}),
              ...(input.message
                ? { sponsorMessage: input.message, messageStatus: 'APPROVED' as const }
                : {}),
              showSponsorName: !!input.sponsorName,
              status: 'PAID',
              paidAt: now,
              clientRequestId: input.idempotencyKey,
            },
          });
          orderId = order.id;
          code = order.publicCode;
          await audit(
            {
              action: 'order.manual',
              actor: ctx.actor,
              requestId: ctx.requestId,
              targetType: 'Order',
              targetId: order.id,
              metadata: {
                kind: order.kind,
                totalCents: amount,
                named: !!input.sponsorName,
                message: !!input.message,
              },
            },
            t,
          );
        },
        { isolationLevel: 'ReadCommitted', timeout: 10_000 },
      );
      break;
    } catch (err) {
      const unique = uniqueViolation(err);
      if (unique === 'Order_contactEmail_clientRequestId_key') throw ManualProblems.duplicate();
      if (unique === 'order_one_active_movie') {
        throw ManualProblems.unavailable('Este filme já tem um patrocinador. Atualize a lista.');
      }
      if (unique?.includes('publicCode') && attempt < 2) continue;
      throw err;
    }
  }
  await announceProgress(orderId, code, item.campaign?.id ?? null, 'PAID', now);
  // a "Já pago" is a sponsorship too: "Novo patrocínio" on stream and in chat (2026-11-09)
  await announcePaidOrder(orderId);
  return getOrder(ctx.actor.role, orderId);
}

/**
 * Undo a "Já pago" registered by mistake (before the title is on stream): the order is CANCELLED
 * and what it took is given back — the movie returns to the catalogue, the contribution leaves its
 * campaign (a FUNDED campaign opens again). Only MANUAL orders; site payments are refunded instead.
 */
export async function undoManualPayment(
  ctx: Ctx,
  id: string,
  expectedVersion: number,
  now = new Date(),
) {
  let code = '';
  let campaignId: string | null = null;
  await db().$transaction(
    async (t) => {
      const o = await t.order.findUnique({ where: { id }, include: { campaign: true } });
      if (!o) throw Problems.notFound();
      if (o.source !== 'MANUAL') {
        throw AdminOrderProblems.notAcceptable(
          'Só pagamentos registrados à mão podem ser desfeitos.',
        );
      }
      if (!['PAID', 'SCHEDULED'].includes(o.status) || o.version !== expectedVersion) {
        throw o.version !== expectedVersion
          ? AdminOrderProblems.changed()
          : AdminOrderProblems.notAcceptable(
              'Este título já passou na live: não dá para desfazer.',
            );
      }
      code = o.publicCode;
      campaignId = o.campaignId;
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
      } else {
        const c = o.campaign;
        if (
          !c ||
          !['OPEN', 'PAUSED', 'FUNDED'].includes(c.status) ||
          c.raisedCents < o.totalCents
        ) {
          throw AdminOrderProblems.notAcceptable(
            'A campanha já foi agendada ou assistida: esta contribuição não pode mais sair dela.',
          );
        }
        const wasFunded = c.status === 'FUNDED';
        const res = await t.campaign.updateMany({
          where: { id: c.id, version: c.version },
          data: {
            raisedCents: { decrement: o.totalCents },
            remainingCents: { increment: o.totalCents },
            supporterCount: { decrement: 1 },
            ...(wasFunded ? { status: 'OPEN', fundedAt: null } : {}),
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw AdminOrderProblems.changed();
        if (wasFunded) {
          await t.catalogItem.updateMany({
            where: { id: c.itemId, status: 'FUNDED' },
            data: { status: 'ACTIVE' },
          });
        }
      }
      const res = await t.order.updateMany({
        where: { id, version: o.version, status: o.status },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          sessionId: null,
          scheduledAt: null,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw AdminOrderProblems.changed();
      await audit(
        {
          action: 'order.manual-undo',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'Order',
          targetId: id,
          metadata: { kind: o.kind, totalCents: o.totalCents, from: o.status },
        },
        t,
      );
    },
    { isolationLevel: 'ReadCommitted', timeout: 10_000 },
  );
  await announceProgress(id, code, campaignId, 'CANCELLED', now);
  await refreshOverlays(['fila', 'meta']);
  return getOrder(ctx.actor.role, id);
}

async function announceProgress(
  orderId: string,
  code: string,
  campaignId: string | null,
  status: OrderStatus,
  now: Date,
) {
  await publishOrder(orderId, { type: 'status', code, status, at: now.toISOString() });
  if (!campaignId) return;
  const c = await db().campaign.findUnique({ where: { id: campaignId } });
  if (c) {
    await publishCampaign(c.id, {
      type: 'progress',
      raisedCents: c.raisedCents,
      remainingCents: c.remainingCents,
      supporterCount: c.supporterCount,
      state: campaignState(c, now),
      at: now.toISOString(),
    });
  }
}
