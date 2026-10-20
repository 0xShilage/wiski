import 'server-only';
import { z } from 'zod';
import type { Order, Prisma, User, Voucher } from '@/generated/prisma/client';
import { MIN_CONTRIBUTION_CENTS } from '@/lib/catalog/pricing';
import { type Breakdown, type Perk, PriceError, priceMovie } from '@/lib/pricing/engine';
import { campaignState } from '../catalog/campaigns';
import { db } from '../db';
import { PG, pgErrorCode } from '../db-errors';
import { holdReceiptInTx } from '../email/outbox';
import { getEnv } from '../env';
import { HttpError, Problems } from '../http/problem';
import { enqueue } from '../jobs/queues';
import { type AcceptedVersions, checkAcceptance, recordAcceptance } from '../legal/legal';
import { logger } from '../log';
import {
  cancelMpOrder,
  createPixOrder,
  type CreatedPix,
  MercadoPagoError,
} from '../payments/mercadopago';
import { reserveQueueJump } from '../pricing/queue-jump';
import { activeRuleSet, type ActiveRuleSet } from '../pricing/rulesets';
import { reserveVoucher, termsOf, usableVoucher } from '../pricing/vouchers';
import { redis } from '../redis';
import { seal, sha256, unseal } from '../security/crypto';
import { plainText } from '../text/sanitize';
import {
  buyerKeyForEmail,
  buyerKeyForUser,
  newAccessToken,
  newPublicCode,
  normaliseEmail,
  uuidv7,
} from './identity';
import {
  expireOrderInTx,
  GRACE_MINUTES,
  PIX_MINUTES,
  publishOrderState,
  releaseHoldsInTx,
} from './lifecycle';
import { OrderProblems } from './problems';

/**
 * Checkout (01 §3.2, 11 §2): movie sponsorships (one sponsor pays the full price; the movie is
 * reserved while the Pix is pending) and campaign contributions (any whole-real amount ≥ R$ 5,
 * capped at what's left; the amount is reserved while the Pix is pending — no overfunding).
 *
 * Order of work: validate + price (no writes) → ONE transaction that creates the order and takes
 * every hold (movie or campaign reservation, voucher, queue-jump slot, legal acceptances, payment
 * row, held receipt) → Mercado Pago creates the Pix (outside the transaction; idempotency key) →
 * on failure everything is released again and nothing was charged.
 */
type Tx = Prisma.TransactionClient;

export type Buyer = {
  user: User | null;
  ipKey: string;
  requestId: string;
};

const TOTAL_TTL_MIN = PIX_MINUTES + GRACE_MINUTES;
/** Bursts (a streamer shout-out) queue for a pool connection instead of failing at 2 s. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;
const MAX_PENDING_PER_IP = 2;

export const legalVersionsSchema = z
  .object({ terms: z.string().max(40), privacy: z.string().max(40), refund: z.string().max(40) })
  .strict();

const displayNameSchema = z.string().max(60);
const messageSchema = z.string().max(400);

export const sponsorFieldsSchema = {
  contactEmail: z.string().max(254).optional(),
  displayName: displayNameSchema.optional(),
  message: messageSchema.optional(),
  showSponsorName: z.boolean().default(true),
  legal: legalVersionsSchema,
};

export type SponsorFields = {
  contactEmail?: string | undefined;
  displayName?: string | undefined;
  message?: string | undefined;
  showSponsorName: boolean;
  legal: AcceptedVersions;
};

export type CheckoutResult = {
  order: OrderSummary;
  pix: { qrCode: string; qrCodeBase64: string; ticketUrl: string | null; expiresAt: string };
  accessToken: string;
};

export type OrderSummary = {
  id: string;
  publicCode: string;
  kind: 'MOVIE' | 'CONTRIBUTION';
  status: string;
  totalCents: number;
  lines: Breakdown['lines'];
};

// ── buyer ───────────────────────────────────────────────────────────────────────────────────

function perkOf(user: User | null): Perk {
  if (!user || user.status !== 'ACTIVE') return null;
  if (user.role === 'MODERATOR' || user.role === 'STREAMER') return 'MODERATOR';
  return user.isVip ? 'VIP' : null;
}

function resolveBuyer(b: Buyer, contactEmail: string | undefined) {
  if (b.user) {
    if (b.user.status !== 'ACTIVE') throw Problems.notFound();
    const email = normaliseEmail(b.user.email);
    return { email, buyerKey: buyerKeyForUser(b.user.id), userId: b.user.id };
  }
  if (!contactEmail) throw OrderProblems.contactEmailRequired();
  const email = normaliseEmail(contactEmail);
  return { email, buyerKey: buyerKeyForEmail(email), userId: null };
}

/** Sanitised, length-capped public texts (moderated before they are shown — 03 §5.6). */
function publicTexts(user: User | null, f: SponsorFields) {
  const name = user ? null : f.displayName ? plainText(f.displayName).slice(0, 24) || null : null;
  const message = f.message ? plainText(f.message).slice(0, 140) || null : null;
  return {
    guestDisplayName: name,
    displayNameStatus: name ? ('PENDING' as const) : null,
    sponsorMessage: message,
    messageStatus: message ? ('PENDING' as const) : null,
    showSponsorName: f.showSponsorName,
  };
}

// ── idempotent replay (Idempotency-Key, 03 §1) ───────────────────────────────────────────────

const IDEM_TTL_SEC = 24 * 3600;
const idemKey = (buyerKey: string, key: string) =>
  `idem:checkout:${sha256(`${buyerKey}|${key}`).toString('hex')}`;
const sealKeys = () => {
  const env = getEnv();
  return { current: env.COOKIE_SEAL_KEY, previous: env.COOKIE_SEAL_KEY_PREVIOUS };
};

async function replay(
  buyerKey: string,
  key: string,
  requestHash: string,
): Promise<CheckoutResult | null> {
  const raw = await redis()
    .get(idemKey(buyerKey, key))
    .catch(() => null);
  if (!raw) return null;
  const v = unseal<{ h: string; r: CheckoutResult }>(raw, sealKeys(), 'checkout-replay');
  if (!v) return null;
  if (v.h !== requestHash) throw OrderProblems.idempotencyConflict();
  return v.r;
}

async function remember(buyerKey: string, key: string, requestHash: string, r: CheckoutResult) {
  await redis()
    .set(
      idemKey(buyerKey, key),
      seal({ h: requestHash, r }, sealKeys(), 'checkout-replay', IDEM_TTL_SEC * 1000),
      'EX',
      IDEM_TTL_SEC,
    )
    .catch(() => {});
}

// ── per-IP pending limit (04 §5.4: 1 pending per buyer [DB], 2 per IP [here]) ─────────────────

async function ipPendingGuard(ipKey: string): Promise<() => Promise<void>> {
  const key = `pend:ip:${ipKey}`;
  const now = Date.now();
  try {
    const r = redis();
    await r.zremrangebyscore(key, '-inf', now - TOTAL_TTL_MIN * 60_000);
    if ((await r.zcard(key)) >= MAX_PENDING_PER_IP) throw OrderProblems.tooManyPendingFromIp();
    const member = `${now}:${Math.random().toString(36).slice(2)}`;
    await r.zadd(key, now, member);
    await r.pexpire(key, TOTAL_TTL_MIN * 60_000);
    return async () => {
      await r.zrem(key, member).catch(() => {});
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw Problems.unavailable(); // fail closed: a checkout is a mutation
  }
}

// ── quote ───────────────────────────────────────────────────────────────────────────────────

export type QuoteInput = {
  itemId: string;
  queueJumpTierId: string | null;
  voucherCode: string | null;
};

async function movieItem(itemId: string, now: Date) {
  const item = await db().catalogItem.findUnique({ where: { id: itemId } });
  if (!item || item.kind !== 'MOVIE') throw Problems.notFound();
  if (item.status !== 'ACTIVE') throw OrderProblems.itemUnavailable();
  if (item.reservedUntil && item.reservedUntil > now) throw OrderProblems.itemReserved();
  return item;
}

function priceOrThrow(rs: ActiveRuleSet, input: Parameters<typeof priceMovie>[1]): Breakdown {
  try {
    return priceMovie(rs.config, input);
  } catch (err) {
    if (err instanceof PriceError) {
      const status =
        err.code.startsWith('QUEUE_JUMP') || err.code.startsWith('VOUCHER') ? 422 : 409;
      throw new HttpError(status, err.code, priceErrorText[err.code]);
    }
    throw err;
  }
}

const priceErrorText: Record<PriceError['code'], string> = {
  RUNTIME_OUT_OF_RANGE: 'A duração deste filme está fora do permitido.',
  QUEUE_JUMP_DISABLED: 'Os furos de fila estão desativados no momento.',
  QUEUE_JUMP_TIER_INVALID: 'Opção de furo de fila inválida.',
  VOUCHER_MIN_SUBTOTAL: 'Este cupom não vale para este valor.',
  TOTAL_BELOW_MIN: 'O valor do pedido ficou abaixo do mínimo.',
  TOTAL_ABOVE_LIMIT: 'O valor do pedido passa do limite permitido.',
};

export async function quoteMovie(b: Buyer, input: QuoteInput, now = new Date()) {
  const item = await movieItem(input.itemId, now);
  const rs = await activeRuleSet();
  let voucher: Voucher | null = null;
  if (input.voucherCode) {
    voucher = await usableVoucher(input.voucherCode, {
      ipKey: b.ipKey,
      buyerKey: b.user ? buyerKeyForUser(b.user.id) : null,
      now,
    });
  }
  const breakdown = priceOrThrow(rs, {
    runtimeMinutes: item.runtimeMinutes,
    queueJumpTierId: input.queueJumpTierId,
    voucher: voucher ? termsOf(voucher) : null,
    perk: perkOf(b.user),
  });
  return {
    item: { id: item.id, title: item.title, runtimeMinutes: item.runtimeMinutes },
    breakdown,
    queueJump: rs.config.queueJump.enabled
      ? rs.config.queueJump.tiers.map((t) => ({
          id: t.id,
          label: t.label,
          bps: t.bps,
          placement: t.placement,
        }))
      : [],
  };
}

// ── shared write path ───────────────────────────────────────────────────────────────────────

type Draft = {
  kind: 'MOVIE' | 'CONTRIBUTION';
  itemId: string;
  campaignId: string | null;
  ruleSetId: string | null;
  runtimeMinutes: number | null;
  queueJumpTierId: string | null;
  breakdown: Breakdown;
};

/** Run the order transaction; unique-index races (codes, queue-jump indexes) retry it. */
async function writeOrder(
  b: Buyer,
  buyer: ReturnType<typeof resolveBuyer>,
  fields: SponsorFields,
  draft: Draft,
  idempotencyKey: string,
  hooks: {
    /** takes the movie/campaign reservation BEFORE the order row exists (contention point) */
    reserve: (tx: Tx, orderId: string) => Promise<void>;
    /** holds that reference the order row (voucher, queue-jump slot) */
    after?: (tx: Tx, order: Order) => Promise<void>;
  },
  now: Date,
): Promise<{ order: Order; accessToken: string; paymentId: string; payKey: string }> {
  const legalIds = await checkAcceptance(fields.legal);
  for (let attempt = 0; ; attempt++) {
    const access = newAccessToken();
    const payKey = crypto.randomUUID();
    const orderId = uuidv7(now.getTime());
    try {
      return await db().$transaction(async (tx) => {
        await hooks.reserve(tx, orderId);
        const order = await tx.order.create({
          data: {
            id: orderId,
            publicCode: newPublicCode(),
            kind: draft.kind,
            itemId: draft.itemId,
            userId: buyer.userId,
            contactEmail: buyer.email,
            buyerKey: buyer.buyerKey,
            accessTokenHash: access.hash,
            runtimeMinutes: draft.runtimeMinutes,
            ruleSetId: draft.ruleSetId,
            queueJumpTierId: draft.queueJumpTierId,
            rescheduleCount: draft.kind === 'MOVIE' ? 0 : null,
            campaignId: draft.campaignId,
            breakdown: draft.breakdown.lines as unknown as Prisma.InputJsonValue,
            subtotalCents: draft.breakdown.subtotalCents,
            discountCents: draft.breakdown.discountCents,
            queueJumpCents: draft.breakdown.queueJumpCents,
            totalCents: draft.breakdown.totalCents,
            ...publicTexts(b.user, fields),
            clientRequestId: idempotencyKey,
          },
        });
        await hooks.after?.(tx, order);
        await recordAcceptance(tx, legalIds, fields.legal, {
          orderId: order.id,
          userId: buyer.userId,
        });
        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            idempotencyKey: payKey,
            amountCents: order.totalCents,
            expiresAt: new Date(now.getTime() + PIX_MINUTES * 60_000),
          },
        });
        await holdReceiptInTx(tx, order.id, access.token);
        return { order, accessToken: access.token, paymentId: payment.id, payKey };
      }, TX_OPTIONS);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (pgErrorCode(err) !== PG.uniqueViolation) throw err;
      const target = uniqueTarget(err);
      if (/order_one_pending_per_buyer|buyerKey/.test(target))
        throw OrderProblems.pendingOrderExists();
      if (/order_one_active_movie|itemId/.test(target)) throw OrderProblems.itemReserved();
      if (/clientRequestId/.test(target)) throw OrderProblems.idempotencyConflict();
      if (attempt >= 4) throw err; // public code / queue-jump index collisions: try again
    }
  }
}

function uniqueTarget(err: unknown): string {
  const e = err as {
    meta?: {
      target?: unknown;
      constraint?: unknown;
      driverAdapterError?: { cause?: { constraint?: unknown; originalMessage?: unknown } };
    };
    message?: string;
  };
  const parts = [
    e.meta?.target,
    e.meta?.constraint,
    e.meta?.driverAdapterError?.cause?.constraint,
    e.meta?.driverAdapterError?.cause?.originalMessage,
    e.message,
  ];
  return parts
    .map((p) =>
      Array.isArray(p) ? p.join(',') : typeof p === 'object' ? JSON.stringify(p) : String(p ?? ''),
    )
    .join(' ');
}

/** Ask Mercado Pago for the Pix; on failure undo the order (nothing was charged). */
async function createPix(
  written: { order: Order; paymentId: string; payKey: string },
  email: string,
): Promise<CreatedPix> {
  try {
    const pix = await createPixOrder({
      orderId: written.order.id,
      amountCents: written.order.totalCents,
      payerEmail: email,
      expiresInMinutes: PIX_MINUTES,
      idempotencyKey: written.payKey,
    });
    const pay = pix.payment;
    await db().payment.update({
      where: { id: written.paymentId },
      data: {
        providerOrderId: pix.order.id,
        providerPaymentId: pay.id,
        providerStatus: pix.order.status.slice(0, 40),
        statusDetail: (pix.order.status_detail ?? null)?.slice(0, 60) ?? null,
        lastSyncedAt: new Date(),
      },
    });
    return pix;
  } catch (err) {
    logger.error(
      { orderId: written.order.id, err: err instanceof Error ? err.message : 'unknown' },
      'pix creation failed; order rolled back',
    );
    await db().$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: written.order.id, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), version: { increment: 1 } },
      });
      if (res.count === 1) await releaseHoldsInTx(tx, written.order);
    });
    // If MP did create it before failing to answer, find it with the same key and cancel it.
    if (!(err instanceof MercadoPagoError && err.kind === 'rejected')) {
      await enqueue.paymentRecover(written.order.id);
    }
    if (err instanceof MercadoPagoError && err.kind === 'not-configured') {
      throw new HttpError(503, 'PAYMENTS_NOT_CONFIGURED', 'Os pagamentos ainda não estão ativos.');
    }
    throw OrderProblems.pixUnavailable();
  }
}

async function cachePix(orderId: string, pix: CheckoutResult['pix']): Promise<void> {
  const ttl = Math.max(
    60,
    Math.ceil((new Date(pix.expiresAt).getTime() - Date.now()) / 1000) + GRACE_MINUTES * 60,
  );
  await redis()
    .set(`pix:${orderId}`, JSON.stringify(pix), 'EX', ttl)
    .catch(() => {});
}

async function finish(
  b: Buyer,
  buyerKey: string,
  idempotencyKey: string,
  requestHash: string,
  written: { order: Order; accessToken: string; paymentId: string; payKey: string },
  email: string,
): Promise<CheckoutResult> {
  const pix = await createPix(written, email);
  const pay = await db().payment.findUniqueOrThrow({ where: { id: written.paymentId } });
  const result: CheckoutResult = {
    order: {
      id: written.order.id,
      publicCode: written.order.publicCode,
      kind: written.order.kind,
      status: 'PENDING_PAYMENT',
      totalCents: written.order.totalCents,
      lines: written.order.breakdown as unknown as Breakdown['lines'],
    },
    pix: {
      qrCode: pix.qrCode,
      qrCodeBase64: pix.qrCodeBase64,
      ticketUrl: pix.ticketUrl,
      expiresAt: pay.expiresAt.toISOString(),
    },
    accessToken: written.accessToken,
  };
  await cachePix(written.order.id, result.pix);
  await remember(buyerKey, idempotencyKey, requestHash, result);
  await publishOrderState(written.order.id);
  logger.info(
    { requestId: b.requestId, orderId: written.order.id, kind: written.order.kind },
    'checkout',
  );
  return result;
}

// ── movie ───────────────────────────────────────────────────────────────────────────────────

export type MovieCheckoutInput = SponsorFields & {
  itemId: string;
  queueJumpTierId: string | null;
  voucherCode: string | null;
  expectedTotalCents: number;
};

export async function checkoutMovie(
  b: Buyer,
  input: MovieCheckoutInput,
  idempotencyKey: string,
  requestHash: string,
  now = new Date(),
): Promise<CheckoutResult> {
  const buyer = resolveBuyer(b, input.contactEmail);
  const replayed = await replay(buyer.buyerKey, idempotencyKey, requestHash);
  if (replayed) return replayed;

  const item = await db().catalogItem.findUnique({ where: { id: input.itemId } });
  if (!item || item.kind !== 'MOVIE') throw Problems.notFound();
  if (item.status !== 'ACTIVE') throw OrderProblems.itemUnavailable();
  if (item.reservedUntil && item.reservedUntil > now) throw OrderProblems.itemReserved();

  const rs = await activeRuleSet();
  let voucher: Voucher | null = null;
  if (input.voucherCode) {
    voucher = await usableVoucher(input.voucherCode, {
      ipKey: b.ipKey,
      buyerKey: buyer.buyerKey,
      now,
    });
  }
  const breakdown = priceOrThrow(rs, {
    runtimeMinutes: item.runtimeMinutes,
    queueJumpTierId: input.queueJumpTierId,
    voucher: voucher ? termsOf(voucher) : null,
    perk: perkOf(b.user),
  });
  if (breakdown.totalCents !== input.expectedTotalCents)
    throw OrderProblems.priceChanged(breakdown);

  const release = await ipPendingGuard(b.ipKey);
  const superseded: string[] = [];
  let written;
  try {
    written = await writeOrder(
      b,
      buyer,
      input,
      {
        kind: 'MOVIE',
        itemId: item.id,
        campaignId: null,
        ruleSetId: rs.id,
        runtimeMinutes: item.runtimeMinutes,
        queueJumpTierId: breakdown.tier?.id ?? null,
        breakdown,
      },
      idempotencyKey,
      {
        reserve: async (tx, orderId) => {
          // A reservation whose Pix window is over but the sweep hasn't run yet: expire it now.
          const current = await tx.catalogItem.findUniqueOrThrow({ where: { id: item.id } });
          if (current.reservedOrderId && current.reservedUntil && current.reservedUntil <= now) {
            if (await expireOrderInTx(tx, current.reservedOrderId, now)) {
              superseded.push(current.reservedOrderId);
            }
          }
          // One winner: the row lock serialises racing buyers; the rest see a reservation.
          const res = await tx.catalogItem.updateMany({
            where: {
              id: item.id,
              status: 'ACTIVE',
              OR: [{ reservedUntil: null }, { reservedUntil: { lte: now } }],
            },
            data: {
              reservedUntil: new Date(now.getTime() + TOTAL_TTL_MIN * 60_000),
              reservedOrderId: orderId,
            },
          });
          if (res.count !== 1) throw OrderProblems.itemReserved();
        },
        after: async (tx, order) => {
          if (voucher && breakdown.voucherApplied) {
            await reserveVoucher(tx, voucher, {
              orderId: order.id,
              buyerKey: buyer.buyerKey,
              userId: buyer.userId,
              discountCents: breakdown.discountCents,
            });
          }
          if (breakdown.tier) {
            const tier = rs.config.queueJump.tiers.find((t) => t.id === breakdown.tier!.id)!;
            await reserveQueueJump(tx, rs.config, tier, {
              orderId: order.id,
              buyerKey: buyer.buyerKey,
              now,
              expiresAt: new Date(now.getTime() + TOTAL_TTL_MIN * 60_000),
            });
          }
        },
      },
      now,
    );
  } catch (err) {
    await release();
    throw err;
  }
  for (const id of superseded) {
    await publishOrderState(id);
    await enqueue.paymentCancel(id);
  }
  try {
    return await finish(b, buyer.buyerKey, idempotencyKey, requestHash, written, buyer.email);
  } catch (err) {
    await release();
    throw err;
  }
}

// ── contribution ────────────────────────────────────────────────────────────────────────────

export type ContributionInput = SponsorFields & { amountCents: number };

/**
 * A contribution fits when it closes the goal exactly or leaves at least R$ 5 for the next one
 * (11 §2.2: every contribution is a whole amount ≥ R$ 5, so a smaller remainder could never be
 * paid). Goals and contributions are whole reais, so the remainder always is too.
 */
export function fitsRemaining(amountCents: number, remainingCents: number): boolean {
  return amountCents === remainingCents || amountCents + MIN_CONTRIBUTION_CENTS <= remainingCents;
}

export async function checkoutContribution(
  b: Buyer,
  campaignId: string,
  input: ContributionInput,
  idempotencyKey: string,
  requestHash: string,
  now = new Date(),
): Promise<CheckoutResult> {
  const buyer = resolveBuyer(b, input.contactEmail);
  const replayed = await replay(buyer.buyerKey, idempotencyKey, requestHash);
  if (replayed) return replayed;

  const campaign = await db().campaign.findUnique({
    where: { id: campaignId },
    include: { item: true },
  });
  if (!campaign || campaign.item.status === 'DRAFT' || campaign.item.status === 'ARCHIVED') {
    throw Problems.notFound();
  }
  if (campaignState(campaign, now) !== 'OPEN' || campaign.item.status !== 'ACTIVE') {
    throw OrderProblems.campaignClosed();
  }
  const amount = input.amountCents;
  if (!Number.isSafeInteger(amount) || amount < MIN_CONTRIBUTION_CENTS || amount % 100 !== 0) {
    throw Problems.validation([
      { path: 'amountCents', message: 'Contribua com um valor inteiro a partir de R$ 5,00.' },
    ]);
  }
  if (!fitsRemaining(amount, campaign.remainingCents)) {
    throw OrderProblems.amountAboveRemaining(campaign.remainingCents);
  }

  const breakdown: Breakdown = {
    lines: [
      { kind: 'base', label: `Contribuição para “${campaign.item.title}”`, cents: amount },
      { kind: 'total', label: 'Total', cents: amount },
    ],
    subtotalCents: amount,
    discountCents: 0,
    discountSource: null,
    voucherApplied: false,
    queueJumpCents: 0,
    totalCents: amount,
    tier: null,
  };

  const release = await ipPendingGuard(b.ipKey);
  let written;
  try {
    written = await writeOrder(
      b,
      buyer,
      input,
      {
        kind: 'CONTRIBUTION',
        itemId: campaign.itemId,
        campaignId: campaign.id,
        ruleSetId: null,
        runtimeMinutes: null,
        queueJumpTierId: null,
        breakdown,
      },
      idempotencyKey,
      {
        reserve: async (tx) => {
          // No overfunding: take the amount only if it still fits (conditional decrement + CHECK).
          const res = await tx.campaign.updateMany({
            where: {
              id: campaign.id,
              status: 'OPEN',
              deadlineAt: { gt: now },
              // fits, and never leaves R$ 0,01–4,99 that no contribution could close
              OR: [
                { remainingCents: amount },
                { remainingCents: { gte: amount + MIN_CONTRIBUTION_CENTS } },
              ],
            },
            data: {
              remainingCents: { decrement: amount },
              reservedCents: { increment: amount },
              version: { increment: 1 },
            },
          });
          if (res.count !== 1) {
            const c = await tx.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
            if (campaignState(c, now) !== 'OPEN') throw OrderProblems.campaignClosed();
            throw OrderProblems.amountAboveRemaining(c.remainingCents);
          }
        },
      },
      now,
    );
  } catch (err) {
    await release();
    throw err;
  }
  try {
    return await finish(b, buyer.buyerKey, idempotencyKey, requestHash, written, buyer.email);
  } catch (err) {
    await release();
    throw err;
  }
}

/** payment.recover: a create that failed mid-way may still exist at MP — cancel it. */
export async function recoverFailedCreate(orderId: string): Promise<'cancelled' | 'none'> {
  const order = await db().order.findUnique({ where: { id: orderId }, include: { payment: true } });
  const p = order?.payment;
  if (!order || !p || order.status !== 'CANCELLED' || p.status !== 'PENDING') return 'none';
  try {
    const pix = await createPixOrder({
      orderId: order.id,
      amountCents: p.amountCents,
      payerEmail: order.contactEmail,
      expiresInMinutes: PIX_MINUTES,
      idempotencyKey: p.idempotencyKey,
    });
    await cancelMpOrder(pix.order.id, `cancel-${p.id}`);
    await db().payment.update({
      where: { id: p.id },
      data: {
        providerOrderId: pix.order.id,
        providerPaymentId: pix.payment.id,
        status: 'CANCELLED',
        lastSyncedAt: new Date(),
        version: { increment: 1 },
      },
    });
    return 'cancelled';
  } catch (err) {
    if (err instanceof MercadoPagoError && err.kind === 'rejected') return 'none';
    throw err;
  }
}
