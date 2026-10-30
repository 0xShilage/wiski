import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Order, Payment, User } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { db } from '../db';
import { HttpError, Problems } from '../http/problem';
import { logger } from '../log';
import { cancelPayment, MpError } from '../payments/mercadopago/client';
import { announce, syncPayment } from '../payments/sync';
import { meetsAccess } from '../rbac';
import { safeEqual, sha256Bytes } from '../security/crypto';
import { CSRF_HEADER } from '../security/csrf';
import { PUBLIC_CODE } from './buyer';
import { releaseHolds } from './holds';
import {
  isValidOrderCsrf,
  orderCsrfToken,
  readOrderCookie,
  withOrder,
  writeOrderCookie,
} from './order-cookie';
import { dropPix, loadPix } from './pix-cache';

/**
 * Who may see or act on an order (03 §5.3, 05 §5 "guest checkout"): the signed-in owner, a
 * browser holding the order in its sealed `__Host-wf_order` cookie, or a moderator (read only).
 * Anything else is 404 — the public code alone grants nothing and leaks nothing.
 */
type OrderRow = Order & {
  payment: Payment | null;
  item: { kind: string; slug: string; title: string };
};

export function codeParam(value: unknown): string {
  if (typeof value === 'string' && PUBLIC_CODE.test(value)) return value;
  throw Problems.notFound();
}

async function findByCode(code: string): Promise<OrderRow | null> {
  return (await db().order.findUnique({
    where: { publicCode: code },
    include: { payment: true, item: { select: { kind: true, slug: true, title: true } } },
  })) as OrderRow | null;
}

export type Viewer = { kind: 'owner' | 'cookie' | 'staff' };

export function viewerOf(order: Order, user: User | null, req: NextRequest): Viewer | null {
  if (user && order.userId === user.id) return { kind: 'owner' };
  const cookie = readOrderCookie(req);
  if (cookie?.orders.includes(order.id)) return { kind: 'cookie' };
  if (user && meetsAccess(user.role, 'moderator')) return { kind: 'staff' };
  return null;
}

export async function loadVisibleOrder(code: string, user: User | null, req: NextRequest) {
  const order = await findByCode(code);
  if (!order) throw Problems.notFound();
  const viewer = viewerOf(order, user, req);
  if (!viewer) throw Problems.notFound();
  return { order, viewer };
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

/** The order page's data. Pix payload only while the order is unpaid and not expired. */
export async function orderView(
  order: OrderRow,
  viewer: Viewer,
  user: User | null,
  req: NextRequest,
) {
  const pending = order.status === 'PENDING_PAYMENT';
  const expiresAt = order.payment?.expiresAt ?? null;
  const pix =
    pending && order.payment && expiresAt && expiresAt > new Date()
      ? await loadPix(order.id, order.payment.providerPaymentId, expiresAt)
      : null;
  const cookie = readOrderCookie(req);
  return {
    order: {
      code: order.publicCode,
      kind: order.kind,
      status: order.status,
      item: order.item,
      breakdown: order.breakdown,
      totalCents: order.totalCents,
      createdAt: order.createdAt.toISOString(),
      expiresAt: expiresAt?.toISOString() ?? null,
      paidAt: order.paidAt?.toISOString() ?? null,
      contactEmail: maskEmail(order.contactEmail),
      anonymous: !order.showSponsorName,
      displayName: order.guestDisplayName,
      displayNameStatus: order.displayNameStatus,
      message: order.sponsorMessage,
      messageStatus: order.messageStatus,
      pix,
      guest: order.userId === null,
    },
    canClaim: Boolean(user) && order.userId === null && viewer.kind === 'cookie',
    canCancel: pending && viewer.kind !== 'staff',
    /** for guest mutations (cancel) — bound to this browser's order cookie (03 §2) */
    orderCsrf: viewer.kind === 'cookie' && cookie ? orderCsrfToken(cookie) : null,
  };
}

/** Order-link exchange: `{token}` from the URL fragment → the order joins this browser's cookie. */
export async function exchangeToken(code: string, token: string, req: NextRequest, ipKey: string) {
  const order = await db().order.findUnique({
    where: { publicCode: code },
    select: { id: true, accessTokenHash: true },
  });
  // Same 404 for "no such code" and "wrong token": no oracle.
  if (!order || !safeEqual(sha256Bytes(token), order.accessTokenHash)) {
    logger.warn({ security: 'order-token-mismatch', ipKey }, 'order access refused');
    throw Problems.notFound();
  }
  const res = NextResponse.json({ ok: true });
  writeOrderCookie(res, withOrder(readOrderCookie(req), order.id));
  return res;
}

export async function claimOrder(code: string, user: User, req: NextRequest, requestId: string) {
  const order = await findByCode(code);
  if (!order || viewerOf(order, user, req)?.kind !== 'cookie') throw Problems.notFound();
  if (order.userId !== null) {
    throw new HttpError(409, 'ALREADY_CLAIMED', 'Este pedido já está vinculado a uma conta.');
  }
  await db().$transaction(async (t) => {
    const res = await t.order.updateMany({
      where: { id: order.id, userId: null, version: order.version },
      data: { userId: user.id, claimedAt: new Date(), version: { increment: 1 } },
    });
    if (res.count !== 1)
      throw new HttpError(409, 'ALREADY_CLAIMED', 'Este pedido já está vinculado a uma conta.');
    await t.legalAcceptance.updateMany({
      where: { orderId: order.id, userId: null },
      data: { userId: user.id },
    });
    await t.voucherRedemption.updateMany({
      where: { orderId: order.id, userId: null },
      data: { userId: user.id },
    });
    await audit(
      {
        action: 'order.claim',
        actor: { id: user.id, role: user.role },
        requestId,
        targetType: 'Order',
        targetId: order.id,
        metadata: { kind: order.kind },
      },
      t,
    );
  });
  return { ok: true };
}

/**
 * Cancel an unpaid order (owner or cookie holder). Mercado Pago is asked first; if the Pix was
 * paid in the meantime the sync applies the payment instead and the buyer gets 409.
 */
export async function cancelOrder(
  code: string,
  user: User | null,
  req: NextRequest,
  requestId: string,
) {
  const { order, viewer } = await loadVisibleOrder(code, user, req);
  if (viewer.kind === 'staff') throw Problems.notFound(); // staff tools are Phase 4
  // Guests: the session-less CSRF token is bound to the order cookie (03 §2).
  if (!user && !isValidOrderCsrf(req.headers.get(CSRF_HEADER), readOrderCookie(req))) {
    throw Problems.forbiddenOrigin();
  }
  if (order.status !== 'PENDING_PAYMENT') {
    throw new HttpError(
      409,
      'NOT_CANCELLABLE',
      'Só pedidos aguardando pagamento podem ser cancelados.',
    );
  }
  const pid = order.payment?.providerPaymentId;
  if (pid) {
    try {
      const mp = await cancelPayment(pid);
      if (mp.status !== 'cancelled') {
        await syncPayment(pid);
        const fresh = await db().order.findUnique({ where: { id: order.id } });
        if (fresh?.status !== 'CANCELLED') {
          throw new HttpError(
            409,
            'ORDER_ALREADY_PAID',
            'Este Pix já foi pago — o pedido não pode mais ser cancelado.',
          );
        }
        return { status: 'CANCELLED' as const };
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof MpError && !err.transient) {
        // e.g. 400 "cannot cancel an approved payment": let the sync decide.
        await syncPayment(pid).catch(() => 'error');
        const fresh = await db().order.findUnique({ where: { id: order.id } });
        if (fresh?.status !== 'PENDING_PAYMENT') {
          if (fresh?.status === 'CANCELLED') return { status: 'CANCELLED' as const };
          throw new HttpError(
            409,
            'ORDER_ALREADY_PAID',
            'Este Pix já foi pago — o pedido não pode mais ser cancelado.',
          );
        }
      }
      throw Problems.unavailable();
    }
  }
  const now = new Date();
  const ok = await db().$transaction(
    async (t) => {
      const res = await t.order.updateMany({
        where: { id: order.id, version: order.version, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED', cancelledAt: now, ipKey: null, version: { increment: 1 } },
      });
      if (res.count !== 1) return false;
      await releaseHolds(t, order);
      if (order.payment) {
        await t.payment.updateMany({
          where: { id: order.payment.id, status: { in: ['PENDING', 'AUTHORIZED', 'IN_PROCESS'] } },
          data: { status: 'CANCELLED', lastSyncedAt: now, version: { increment: 1 } },
        });
      }
      await audit(
        {
          action: 'order.cancel',
          actor: user ? { id: user.id, role: user.role } : null,
          requestId,
          targetType: 'Order',
          targetId: order.id,
          metadata: { kind: order.kind, by: 'buyer' },
        },
        t,
      );
      return true;
    },
    { isolationLevel: 'ReadCommitted', timeout: 10_000 },
  );
  if (!ok)
    throw new HttpError(
      409,
      'NOT_CANCELLABLE',
      'O pedido mudou enquanto você cancelava. Recarregue.',
    );
  await dropPix(order.id);
  await announce(order, 'CANCELLED', now);
  return { status: 'CANCELLED' as const };
}

/** "Meus pedidos" on /perfil. */
export async function myOrders(user: User) {
  const rows = await db().order.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { item: { select: { kind: true, slug: true, title: true } } },
  });
  return rows.map((o) => ({
    code: o.publicCode,
    kind: o.kind,
    status: o.status,
    item: o.item,
    totalCents: o.totalCents,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
  }));
}
