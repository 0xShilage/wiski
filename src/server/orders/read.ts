import 'server-only';
import type { Order, Payment, User } from '@/generated/prisma/client';
import type { PriceLine } from '@/lib/pricing/engine';
import { db } from '../db';
import { logger } from '../log';
import { getMpOrder, isMercadoPagoConfigured, pixPaymentOf } from '../payments/mercadopago';
import { redis } from '../redis';
import { PUBLIC_CODE_PATTERN } from './identity';

/**
 * The buyer's view of an order (03 §5.3). Access: the signed-in owner, a guest holding the order
 * in `__Host-wf_order`, or staff. Anyone else gets 404 (no existence leak). Never shows the full
 * contact e-mail, internal ids of other people, or Mercado Pago identifiers.
 */
export function publicCodeOk(code: unknown): code is string {
  return typeof code === 'string' && PUBLIC_CODE_PATTERN.test(code);
}

export function canAccessOrder(
  order: Pick<Order, 'id' | 'userId'>,
  who: { user: Pick<User, 'id' | 'role'> | null; cookieIds: readonly string[] },
): boolean {
  if (who.user && order.userId === who.user.id) return true;
  if (who.cookieIds.includes(order.id)) return true;
  return who.user?.role === 'MODERATOR' || who.user?.role === 'STREAMER';
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

export type PixPayload = {
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: string | null;
  expiresAt: string;
};

/** The Pix while it is payable: from the cache, else from Mercado Pago (and re-cached). */
async function pixFor(order: Order, payment: Payment): Promise<PixPayload | null> {
  if (order.status !== 'PENDING_PAYMENT' || payment.status !== 'PENDING') return null;
  if (payment.expiresAt.getTime() <= Date.now()) return null;
  try {
    const cached = await redis().get(`pix:${order.id}`);
    if (cached) return JSON.parse(cached) as PixPayload;
  } catch {
    // fall through to the provider
  }
  if (!payment.providerOrderId || !isMercadoPagoConfigured()) return null;
  try {
    const mp = await getMpOrder(payment.providerOrderId);
    const pm = pixPaymentOf(mp)?.payment_method;
    if (!pm?.qr_code || !pm.qr_code_base64) return null;
    const pix: PixPayload = {
      qrCode: pm.qr_code,
      qrCodeBase64: pm.qr_code_base64,
      ticketUrl: pm.ticket_url ?? null,
      expiresAt: payment.expiresAt.toISOString(),
    };
    const ttl = Math.ceil((payment.expiresAt.getTime() - Date.now()) / 1000) + 300;
    await redis()
      .set(`pix:${order.id}`, JSON.stringify(pix), 'EX', Math.max(60, ttl))
      .catch(() => {});
    return pix;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'pix payload unavailable');
    return null;
  }
}

export async function findOrderByCode(code: string) {
  return db().order.findUnique({
    where: { publicCode: code },
    include: {
      payment: true,
      item: { select: { title: true, slug: true, kind: true } },
      campaign: { select: { id: true } },
    },
  });
}

type Full = NonNullable<Awaited<ReturnType<typeof findOrderByCode>>>;

export async function buyerView(order: Full, opts: { withPix: boolean }) {
  const pix = opts.withPix && order.payment ? await pixFor(order, order.payment) : null;
  return {
    publicCode: order.publicCode,
    kind: order.kind,
    status: order.status,
    paymentStatus: order.payment?.status ?? 'PENDING',
    item: { title: order.item.title, slug: order.item.slug, kind: order.item.kind },
    campaignId: order.campaign?.id ?? null,
    totalCents: order.totalCents,
    lines: order.breakdown as unknown as PriceLine[],
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    expiresAt: order.payment?.expiresAt.toISOString() ?? null,
    contactEmail: maskEmail(order.contactEmail),
    claimed: order.userId !== null,
    showSponsorName: order.showSponsorName,
    displayName: order.guestDisplayName,
    displayNameStatus: order.displayNameStatus,
    message: order.sponsorMessage,
    messageStatus: order.messageStatus,
    canCancel: order.status === 'PENDING_PAYMENT',
    pix,
  };
}

export type BuyerOrderView = Awaited<ReturnType<typeof buyerView>>;

/** "Minhas compras" (Perfil): the signed-in user's orders, newest first. */
export async function listMyOrders(userId: string, take = 50) {
  const rows = await db().order.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      item: { select: { title: true, slug: true, kind: true } },
      payment: { select: { status: true } },
    },
  });
  return rows.map((o) => ({
    publicCode: o.publicCode,
    kind: o.kind,
    status: o.status,
    paymentStatus: o.payment?.status ?? 'PENDING',
    item: { title: o.item.title, slug: o.item.slug, kind: o.item.kind },
    totalCents: o.totalCents,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
  }));
}
