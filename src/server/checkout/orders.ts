import 'server-only';
import { NextResponse } from 'next/server';
import type { CatalogItem, Order, Payment, Prisma, User } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { campaignState } from '../catalog/campaigns';
import { db } from '../db';
import { PG, pgErrorCode } from '../db-errors';
import { getEnv } from '../env';
import { HttpError, Problems } from '../http/problem';
import { logger } from '../log';
import {
  createPixPayment,
  MpError,
  type MpPayment,
  pixPayload,
} from '../payments/mercadopago/client';
import { announce, EXPIRY_GRACE_MS, verifyPayment } from '../payments/sync';
import type { PricingConfig } from '../pricing/config';
import {
  type Breakdown,
  checkContribution,
  type Perk,
  PriceError,
  type PriceErrorCode,
  priceMovie,
  type VoucherContext,
} from '../pricing/engine';
import { type ActiveRuleSet, activeRuleSet } from '../pricing/ruleset';
import { hit } from '../ratelimit/sliding-window';
import { redis } from '../redis';
import { seal, sha256, sha256Bytes, unseal } from '../security/crypto';
import { buyerKeyFor, newAccessToken, newPublicCode, normaliseEmail } from './buyer';
import { releaseHolds } from './holds';
import type { ContributionInput, MovieOrderInput, QuoteInput } from './input';
import { readOrderCookie, withOrder, writeOrderCookie } from './order-cookie';
import { cachePix } from './pix-cache';
import { lockQueueJump, queueJumpAvailability } from './queue-jump';
import { CLOSED_COPY, checkoutStatus, currentLegal, type CurrentLegal } from './status';

/**
 * Checkout (01 §3.2, 03 §5.3, 11 §2): quote, movie sponsorship ("Patrocine agora") and campaign
 * contribution ("Contribuir"), for guests and signed-in users.
 *
 * Order of work for a new order:
 *   gate → buyer → idempotency replay → per-buyer limit → ONE transaction (per-IP pending cap,
 *   queue-jump lock, price, order + payment + legal acceptances, movie / campaign reservation,
 *   voucher reservation, queue slot, audit) → Mercado Pago Pix (outside the transaction, with the
 *   payment's idempotency key) → on failure a compensating transaction releases every hold.
 * The database enforces the invariants that matter under concurrency: one active order per
 * movie, one unpaid order per buyer, campaign remaining ≥ 0, queue-jump slot uniqueness.
 */

type Tx = Prisma.TransactionClient;
export type Buyer = {
  user: User | null;
  ipKey: string | null;
  requestId: string;
  idempotencyKey: string;
  req: { cookies: { get(name: string): { value: string } | undefined } };
};

/** MP's minimum Pix expiry is 30 min after issue; 31 keeps a margin. Hold = expiry + grace = 35. */
const PIX_EXPIRY_MS = 31 * 60_000;
const MAX_PENDING_PER_IP = 2;
const BUYER_CREATES_PER_HOUR = 5;
const VOUCHER_FAILS = 5;
const VOUCHER_FAIL_WINDOW_MS = 10 * 60_000;
const VOUCHER_COOLDOWN_S = 15 * 60;
const IDEMPOTENCY_TTL_S = 24 * 3600;

// ── problems (pt-BR) ─────────────────────────────────────────────────────────────

const PRICE_COPY: Record<PriceErrorCode, [number, string]> = {
  KIND_DISABLED: [422, 'Patrocínios de filmes estão desativados no momento.'],
  RUNTIME_UNKNOWN: [422, 'Este filme está sem duração cadastrada.'],
  RUNTIME_OUT_OF_RANGE: [422, 'A duração deste filme está fora do permitido.'],
  ADDON_INVALID: [422, 'Opção adicional inválida.'],
  VOUCHER_INVALID: [422, 'Cupom inválido para este pedido.'],
  VOUCHER_EXPIRED: [422, 'Este cupom não está valendo agora.'],
  VOUCHER_SOLD_OUT: [409, 'Este cupom já se esgotou.'],
  VOUCHER_USER_LIMIT: [409, 'Você já usou este cupom.'],
  QUEUE_JUMP_DISABLED: [422, 'O furar fila está desativado no momento.'],
  QUEUE_JUMP_TIER_INVALID: [422, 'Opção de fila inválida.'],
  QUEUE_JUMP_SOLD_OUT: [409, 'As vagas para furar a fila hoje/nesta semana acabaram.'],
  QUEUE_JUMP_BUYER_LIMIT: [
    409,
    'Você já furou a fila hoje. Tente amanhã ou escolha a fila normal.',
  ],
  TOTAL_ABOVE_LIMIT: [422, 'O valor passa do limite por pedido.'],
  TOTAL_BELOW_LIMIT: [422, 'O valor fica abaixo do mínimo por pedido.'],
};

function priceProblem(e: PriceError): HttpError {
  const [status, detail] = PRICE_COPY[e.code];
  return new HttpError(status, e.code, detail);
}

export const CheckoutProblems = {
  closed: (reason: keyof typeof CLOSED_COPY) =>
    new HttpError(503, 'SPONSORSHIPS_CLOSED', CLOSED_COPY[reason], { members: { reason } }),
  movieUnavailable: () =>
    new HttpError(
      409,
      'MOVIE_UNAVAILABLE',
      'Este filme acabou de ser reservado ou patrocinado por outra pessoa.',
    ),
  campaignClosed: () =>
    new HttpError(409, 'CAMPAIGN_CLOSED', 'Esta campanha não está recebendo contribuições agora.'),
  aboveRemaining: (remainingCents: number) =>
    new HttpError(409, 'AMOUNT_ABOVE_REMAINING', 'O valor passa do que falta para a meta.', {
      members: { remainingCents: String(remainingCents) },
    }),
  amountInvalid: () =>
    new HttpError(422, 'AMOUNT_INVALID', 'Escolha um valor inteiro em reais, a partir de R$ 5.'),
  pendingExists: () =>
    new HttpError(
      409,
      'PENDING_ORDER_EXISTS',
      'Você já tem um pedido aguardando pagamento. Pague ou cancele esse antes.',
    ),
  pendingIpLimit: () =>
    new HttpError(
      429,
      'PENDING_ORDER_LIMIT',
      'Há pedidos demais aguardando pagamento nesta conexão. Tente mais tarde.',
    ),
  priceChanged: (b: Breakdown) =>
    new HttpError(409, 'PRICE_CHANGED', 'O preço mudou. Confira o novo valor antes de pagar.', {
      members: { totalCents: String(b.totalCents) },
    }),
  legalChanged: () =>
    new HttpError(
      409,
      'LEGAL_CHANGED',
      'Os termos foram atualizados. Recarregue a página e leia a nova versão.',
    ),
  emailRequired: () =>
    Problems.validation([
      { path: 'contactEmail', message: 'Informe um e-mail para receber o pedido.' },
    ]),
  displayNameForGuests: () =>
    Problems.validation([{ path: 'displayName', message: 'Só para quem compra sem login.' }]),
  suspended: () =>
    new HttpError(403, 'ACCOUNT_SUSPENDED', 'Sua conta está suspensa e não pode fazer pedidos.'),
  voucherCooldown: () =>
    new HttpError(429, 'VOUCHER_COOLDOWN', 'Muitos cupons inválidos. Aguarde 15 minutos.', {
      headers: { 'retry-after': String(VOUCHER_COOLDOWN_S) },
    }),
  providerUnavailable: () =>
    new HttpError(
      503,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Não foi possível gerar o Pix agora. Nada foi cobrado — tente de novo em instantes.',
    ),
  idempotencyConflict: () =>
    new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Este pedido já foi enviado. Recarregue a página.'),
};

// ── helpers ───────────────────────────────────────────────────────────────────────

export function perkFor(user: User | null): Perk {
  if (!user || user.status !== 'ACTIVE') return 'NONE';
  if (user.role === 'MODERATOR' || user.role === 'STREAMER') return 'MODERATOR';
  return user.isVip ? 'VIP' : 'NONE';
}

async function gate(): Promise<{ rs: ActiveRuleSet; legal: CurrentLegal }> {
  const status = await checkoutStatus();
  if (!status.open) throw CheckoutProblems.closed(status.reason);
  const rs = await activeRuleSet();
  const legal = await currentLegal();
  if (!rs || !legal) throw CheckoutProblems.closed(!rs ? 'NO_PRICES' : 'NO_LEGAL_TEXTS');
  return { rs, legal };
}

/** Unique-violation name (index or constraint) from a Prisma/pg error, if any. */
export function uniqueViolation(err: unknown): string | null {
  const e = err as { code?: string; meta?: unknown } | null;
  if (!e || (e.code !== 'P2002' && pgErrorCode(err) !== PG.uniqueViolation)) return null;
  const text = JSON.stringify(e.meta ?? {}) + String((err as Error).message ?? '');
  for (const name of [
    'order_one_active_movie',
    'order_one_pending_per_buyer',
    'Order_publicCode_key',
    'Order_contactEmail_clientRequestId_key',
    'Order_accessTokenHash_key',
  ]) {
    if (text.includes(name)) return name;
  }
  if (text.includes('publicCode')) return 'Order_publicCode_key';
  if (text.includes('clientRequestId')) return 'Order_contactEmail_clientRequestId_key';
  if (text.includes('buyerKey')) return 'order_one_pending_per_buyer';
  if (text.includes('itemId')) return 'order_one_active_movie';
  return 'unknown';
}

function resolveBuyer(
  user: User | null,
  input: { contactEmail?: string | undefined; displayName?: string | undefined },
) {
  if (user && user.status !== 'ACTIVE') throw CheckoutProblems.suspended();
  if (user && input.displayName !== undefined) throw CheckoutProblems.displayNameForGuests();
  const email = input.contactEmail ?? (user ? normaliseEmail(user.email) : undefined);
  if (!email) throw CheckoutProblems.emailRequired();
  const contactEmail = normaliseEmail(email);
  return { contactEmail, buyerKey: buyerKeyFor(user?.id ?? null, contactEmail) };
}

function checkLegal(
  legal: CurrentLegal,
  accepted: { terms: string; privacy: string; refund: string },
) {
  if (
    accepted.terms !== legal.TERMS.version ||
    accepted.privacy !== legal.PRIVACY.version ||
    accepted.refund !== legal.REFUND.version
  ) {
    throw CheckoutProblems.legalChanged();
  }
}

// Voucher brute-force guard (04 §6): 5 invalid codes / 10 min per IP and per buyer → 15-min cool-down.
async function voucherCoolingDown(keys: string[]): Promise<boolean> {
  try {
    const hits = await Promise.all(keys.map((k) => redis().exists(`vcool:${k}`)));
    return hits.some((n) => n > 0);
  } catch {
    return false;
  }
}

async function voucherFailed(keys: string[]): Promise<void> {
  try {
    for (const k of keys) {
      // the 5th failure inside the window starts the cool-down
      const r = await hit(
        redis(),
        `rl:voucher-invalid:${k}`,
        VOUCHER_FAILS - 1,
        VOUCHER_FAIL_WINDOW_MS,
      );
      if (!r.allowed) {
        await redis().set(`vcool:${k}`, '1', 'EX', VOUCHER_COOLDOWN_S);
        logger.warn({ security: 'voucher-bruteforce', key: k.slice(0, 2) }, 'voucher cool-down');
      }
    }
  } catch {
    /* best effort */
  }
}

const VOUCHER_FORMAT = /^[A-Z0-9-]{8,32}$/;

async function loadVoucher(
  t: Tx | ReturnType<typeof db>,
  code: string | null | undefined,
  buyerKey: string | null,
) {
  if (!code) return null;
  if (!VOUCHER_FORMAT.test(code)) throw new PriceError('VOUCHER_INVALID');
  const v = await t.voucher.findUnique({ where: { code } });
  if (!v) throw new PriceError('VOUCHER_INVALID');
  const buyerRedemptions = buyerKey
    ? await t.voucherRedemption.count({
        where: { voucherId: v.id, buyerKey, status: { in: ['RESERVED', 'CONSUMED'] } },
      })
    : 0;
  const ctx: VoucherContext = {
    code: v.code,
    kind: v.kind,
    percentBps: v.percentBps,
    amountCents: v.amountCents,
    maxDiscountCents: v.maxDiscountCents,
    minSubtotalCents: v.minSubtotalCents,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    active: v.active,
    maxRedemptions: v.maxRedemptions,
    redemptionCount: v.redemptionCount,
    maxPerUser: v.maxPerUser,
    buyerRedemptions,
  };
  return { row: v, ctx };
}

async function liveMovie(movieId: string): Promise<CatalogItem> {
  const item = await db().catalogItem.findUnique({ where: { id: movieId } });
  if (!item || item.kind !== 'MOVIE' || !['ACTIVE', 'SPONSORED', 'WATCHED'].includes(item.status)) {
    throw Problems.notFound();
  }
  return item;
}

function movieAvailable(item: CatalogItem, now: Date): boolean {
  return item.status === 'ACTIVE' && (!item.reservedUntil || item.reservedUntil <= now);
}

// ── quote (side-effect free) ──────────────────────────────────────────────────────

export type Quote = { breakdown: Breakdown; available: boolean; ruleSetVersion: number };

export async function quoteMovie(
  user: User | null,
  ipKey: string | null,
  input: QuoteInput,
  now = new Date(),
): Promise<Quote> {
  const rs = await activeRuleSet();
  if (!rs) throw CheckoutProblems.closed('NO_PRICES');
  const item = await liveMovie(input.movieId);
  const coolKeys = [`ip:${ipKey ?? 'unknown'}`, ...(user ? [`u:${user.id}`] : [])];
  if (input.voucherCode && (await voucherCoolingDown(coolKeys)))
    throw CheckoutProblems.voucherCooldown();
  const buyerKey = user ? buyerKeyFor(user.id, user.email) : null;
  try {
    const voucher = await loadVoucher(db(), input.voucherCode, buyerKey);
    const queueJump = input.queueJumpTier
      ? await queueJumpAvailability(db(), rs.config, input.queueJumpTier, buyerKey ?? 'e:none', now)
      : undefined;
    const breakdown = priceMovie(
      rs.config,
      {
        runtimeMinutes: item.runtimeMinutes,
        queueJumpTierId: input.queueJumpTier,
        baseOverrideCents: item.manualPriceCents,
      },
      {
        perk: perkFor(user),
        voucher: voucher?.ctx ?? null,
        ...(queueJump ? { queueJump } : {}),
        now,
      },
    );
    return { breakdown, available: movieAvailable(item, now), ruleSetVersion: rs.version };
  } catch (e) {
    if (e instanceof PriceError) {
      if (e.code === 'VOUCHER_INVALID') await voucherFailed(coolKeys);
      throw priceProblem(e);
    }
    throw e;
  }
}

// ── create ────────────────────────────────────────────────────────────────────────

export type CreatedOrder = {
  publicCode: string;
  /** shown once; the order link is /pedido/<code>#t=<token> */
  accessToken: string;
  status: 'PENDING_PAYMENT';
  totalCents: number;
  expiresAt: string;
  qrCode: string;
  qrCodeBase64: string;
};

type Prepared = {
  order: Order;
  payment: Payment;
  description: string;
};

/** Idempotent replay: same Idempotency-Key + same buyer → the same response for 24 h (03 §1). */
function idemKey(buyerKey: string, key: string) {
  return `idem:${sha256(`${buyerKey}|${key}`).toString('base64url')}`;
}
function sealKeys() {
  const env = getEnv();
  return { current: env.COOKIE_SEAL_KEY, previous: env.COOKIE_SEAL_KEY_PREVIOUS };
}
async function replay(
  buyerKey: string,
  key: string,
): Promise<{ orderId: string; body: CreatedOrder } | null> {
  try {
    const raw = await redis().get(idemKey(buyerKey, key));
    if (!raw) return null;
    return unseal<{ orderId: string; body: CreatedOrder }>(raw, sealKeys(), 'idempotency');
  } catch {
    return null;
  }
}
async function remember(buyerKey: string, key: string, orderId: string, body: CreatedOrder) {
  try {
    await redis().set(
      idemKey(buyerKey, key),
      seal({ orderId, body }, sealKeys(), 'idempotency', IDEMPOTENCY_TTL_S * 1000),
      'EX',
      IDEMPOTENCY_TTL_S,
    );
  } catch {
    /* the DB unique (contactEmail, clientRequestId) still blocks a duplicate */
  }
}

function respond(buyer: Buyer, orderId: string, body: CreatedOrder): NextResponse {
  const res = NextResponse.json(body, { status: 201 });
  writeOrderCookie(res, withOrder(readOrderCookie(buyer.req), orderId));
  return res;
}

async function buyerRateLimit(buyerKey: string) {
  try {
    const r = await hit(
      redis(),
      `rl:order-create:b:${buyerKey}`,
      BUYER_CREATES_PER_HOUR,
      3_600_000,
    );
    if (!r.allowed) throw Problems.rateLimited(r.retryAfterMs / 1000);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw Problems.unavailable(); // fail closed on mutations
  }
}

/** Per-IP pending cap, under a per-IP advisory lock (reviewed decision 1 in the P2 migration). */
async function lockIp(t: Tx, ipKey: string | null) {
  if (!ipKey) return;
  // Documented tagged-template exception (docs/phase-2/README.md §4).
  await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wiskiflix.order_ip.${ipKey}`}))`;
  const pending = await t.order.count({ where: { ipKey, status: 'PENDING_PAYMENT' } });
  if (pending >= MAX_PENDING_PER_IP) throw CheckoutProblems.pendingIpLimit();
}

async function newOrderRows(
  t: Tx,
  p: {
    kind: 'MOVIE' | 'CONTRIBUTION';
    item: Pick<CatalogItem, 'id'>;
    buyer: Buyer;
    contactEmail: string;
    buyerKey: string;
    accessToken: string;
    legal: CurrentLegal;
    input: { displayName?: string | undefined; anonymous: boolean; message?: string | undefined };
    amounts: {
      breakdown: unknown;
      subtotalCents: number;
      discountCents: number;
      queueJumpCents: number;
      totalCents: number;
    };
    movie?: { runtimeMinutes: number; ruleSetId: string; queueJumpTierId: string | null };
    campaignId?: string;
    now: Date;
  },
) {
  const order = await t.order.create({
    data: {
      publicCode: newPublicCode(),
      kind: p.kind,
      itemId: p.item.id,
      userId: p.buyer.user?.id ?? null,
      contactEmail: p.contactEmail,
      buyerKey: p.buyerKey,
      ipKey: p.buyer.ipKey,
      accessTokenHash: sha256Bytes(p.accessToken),
      ...(p.movie
        ? {
            runtimeMinutes: p.movie.runtimeMinutes,
            ruleSetId: p.movie.ruleSetId,
            queueJumpTierId: p.movie.queueJumpTierId,
            rescheduleCount: 0,
          }
        : {}),
      ...(p.campaignId ? { campaignId: p.campaignId } : {}),
      breakdown: p.amounts.breakdown as Prisma.InputJsonValue,
      subtotalCents: p.amounts.subtotalCents,
      discountCents: p.amounts.discountCents,
      queueJumpCents: p.amounts.queueJumpCents,
      totalCents: p.amounts.totalCents,
      ...(p.input.message
        ? // shown without waiting for a moderator (2026-11-03); moderators can hide it in Pedidos
          { sponsorMessage: p.input.message, messageStatus: 'APPROVED' as const }
        : {}),
      ...(p.input.displayName
        ? { guestDisplayName: p.input.displayName, displayNameStatus: 'PENDING' as const }
        : {}),
      showSponsorName: !p.input.anonymous,
      clientRequestId: p.buyer.idempotencyKey,
    },
  });
  const payment = await t.payment.create({
    data: {
      orderId: order.id,
      idempotencyKey: crypto.randomUUID(),
      amountCents: order.totalCents,
      expiresAt: new Date(p.now.getTime() + PIX_EXPIRY_MS),
    },
  });
  await t.legalAcceptance.createMany({
    data: (['TERMS', 'PRIVACY', 'REFUND'] as const).map((type) => ({
      documentId: p.legal[type].id,
      orderId: order.id,
      userId: p.buyer.user?.id ?? null,
      acceptedAt: p.now,
    })),
  });
  return { order, payment };
}

function mapCreateError(err: unknown): never {
  if (err instanceof HttpError) throw err;
  if (err instanceof PriceError) throw priceProblem(err);
  const unique = uniqueViolation(err);
  if (unique === 'order_one_active_movie') throw CheckoutProblems.movieUnavailable();
  if (unique === 'order_one_pending_per_buyer') throw CheckoutProblems.pendingExists();
  if (unique === 'Order_contactEmail_clientRequestId_key')
    throw CheckoutProblems.idempotencyConflict();
  throw err;
}

/** Run the order transaction; one retry on the (rare) public-code collision. */
async function inTx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db().$transaction(fn, { isolationLevel: 'ReadCommitted', timeout: 10_000 });
    } catch (err) {
      if (attempt === 0 && uniqueViolation(err) === 'Order_publicCode_key') continue;
      return mapCreateError(err);
    }
  }
}

/** After the order rows are committed: create the Pix; undo everything if that fails. */
async function issuePix(
  buyer: Buyer,
  prepared: Prepared,
  now: Date,
): Promise<{ mp: MpPayment; pix: { qrCode: string; qrCodeBase64: string } }> {
  const { order, payment } = prepared;
  let mp: MpPayment | null = null;
  let failure: string | null = null;
  try {
    mp = await createPixPayment({
      amountCents: payment.amountCents,
      description: prepared.description,
      externalReference: order.id,
      // with MP test credentials the payer must be a test buyer (development only, env.ts)
      payerEmail: getEnv().MP_TEST_PAYER_EMAIL ?? order.contactEmail,
      payerFirstName: getEnv().MP_TEST_PAYER_EMAIL ? 'APRO' : undefined,
      expiresAt: payment.expiresAt,
      idempotencyKey: payment.idempotencyKey,
    });
  } catch (err) {
    failure = err instanceof MpError ? err.message : 'error';
  }
  let pix = mp ? pixPayload(mp) : null;
  if (mp && !failure) {
    const bad = verifyPayment({ ...payment, providerPaymentId: String(mp.id), order }, mp);
    if (bad) failure = `created payment failed verification: ${bad}`;
    else if (mp.status !== 'pending') failure = `unexpected status ${mp.status}`;
    else if (!pix) failure = 'invalid pix payload';
  }
  if (failure || !mp || !pix) {
    logger.error({ alert: 'payments', orderId: order.id, reason: failure }, 'pix creation failed');
    await db().$transaction(
      async (t) => {
        const res = await t.order.updateMany({
          where: { id: order.id, status: 'PENDING_PAYMENT' },
          data: { status: 'CANCELLED', cancelledAt: now, ipKey: null, version: { increment: 1 } },
        });
        if (res.count === 1) {
          await releaseHolds(t, order);
          await t.payment.update({
            where: { id: payment.id },
            data: { status: 'CANCELLED', ...(mp ? { providerPaymentId: String(mp.id) } : {}) },
          });
          await audit(
            {
              action: 'order.cancel',
              actor: buyer.user ? { id: buyer.user.id, role: buyer.user.role } : null,
              requestId: buyer.requestId,
              targetType: 'Order',
              targetId: order.id,
              metadata: { kind: order.kind, by: 'checkout-failure' },
            },
            t,
          );
        }
      },
      { isolationLevel: 'ReadCommitted', timeout: 10_000 },
    );
    await announce(order, 'CANCELLED', now);
    throw CheckoutProblems.providerUnavailable();
  }
  await db().payment.update({
    where: { id: payment.id },
    data: {
      providerPaymentId: String(mp.id),
      providerUpdatedAt: mp.date_last_updated ? new Date(mp.date_last_updated) : now,
      lastSyncedAt: now,
      statusDetail: mp.status_detail ?? null,
    },
  });
  pix = pix!;
  await cachePix(order.id, pix, payment.expiresAt);
  return { mp, pix };
}

function created(
  prepared: Prepared,
  accessToken: string,
  pix: { qrCode: string; qrCodeBase64: string },
): CreatedOrder {
  return {
    publicCode: prepared.order.publicCode,
    accessToken,
    status: 'PENDING_PAYMENT',
    totalCents: prepared.order.totalCents,
    expiresAt: prepared.payment.expiresAt.toISOString(),
    qrCode: pix.qrCode,
    qrCodeBase64: pix.qrCodeBase64,
  };
}

async function finish(
  buyer: Buyer,
  buyerKey: string,
  prepared: Prepared,
  accessToken: string,
  now: Date,
) {
  const { pix } = await issuePix(buyer, prepared, now);
  const body = created(prepared, accessToken, pix);
  await remember(buyerKey, buyer.idempotencyKey, prepared.order.id, body);
  if (prepared.order.campaignId) await announce(prepared.order, 'PENDING_PAYMENT', now);
  return respond(buyer, prepared.order.id, body);
}

/** "Patrocine agora" — one sponsor pays the whole movie (11 §2.1). */
export async function createMovieOrder(
  buyer: Buyer,
  input: MovieOrderInput,
  now = new Date(),
): Promise<NextResponse> {
  const { rs, legal } = await gate();
  const { contactEmail, buyerKey } = resolveBuyer(buyer.user, input);
  checkLegal(legal, input.legal);
  const again = await replay(buyerKey, buyer.idempotencyKey);
  if (again) return respond(buyer, again.orderId, again.body);
  await buyerRateLimit(buyerKey);

  const item = await liveMovie(input.movieId);
  if (!movieAvailable(item, now)) throw CheckoutProblems.movieUnavailable();
  const coolKeys = [`ip:${buyer.ipKey ?? 'unknown'}`, `b:${buyerKey}`];
  if (input.voucherCode && (await voucherCoolingDown(coolKeys)))
    throw CheckoutProblems.voucherCooldown();
  const accessToken = newAccessToken();

  let prepared: Prepared;
  try {
    prepared = await inTx(async (t) => {
      await lockIp(t, buyer.ipKey);
      const qj = input.queueJumpTier
        ? await lockQueueJump(t, rs.config, input.queueJumpTier, buyerKey, now)
        : null;
      const voucher = await loadVoucher(t, input.voucherCode, buyerKey);
      const breakdown = priceMovie(
        rs.config,
        {
          runtimeMinutes: item.runtimeMinutes,
          queueJumpTierId: input.queueJumpTier,
          baseOverrideCents: item.manualPriceCents,
        },
        {
          perk: perkFor(buyer.user),
          voucher: voucher?.ctx ?? null,
          ...(qj ? { queueJump: qj.availability } : {}),
          now,
        },
      );
      if (breakdown.totalCents !== input.expectedTotalCents)
        throw CheckoutProblems.priceChanged(breakdown);

      const { order, payment } = await newOrderRows(t, {
        kind: 'MOVIE',
        item,
        buyer,
        contactEmail,
        buyerKey,
        accessToken,
        legal,
        input,
        amounts: {
          breakdown: breakdown.lines,
          subtotalCents: breakdown.subtotalCents,
          discountCents: breakdown.discountCents,
          queueJumpCents: breakdown.queueJumpCents,
          totalCents: breakdown.totalCents,
        },
        movie: {
          runtimeMinutes: breakdown.runtimeMinutes,
          ruleSetId: rs.id,
          queueJumpTierId: breakdown.queueJumpTier?.id ?? null,
        },
        now,
      });

      // The movie: only one checkout wins (11 §7), backed by order_one_active_movie.
      const held = await t.catalogItem.updateMany({
        where: {
          id: item.id,
          kind: 'MOVIE',
          status: 'ACTIVE',
          OR: [{ reservedUntil: null }, { reservedUntil: { lte: now } }],
        },
        data: {
          reservedUntil: new Date(payment.expiresAt.getTime() + EXPIRY_GRACE_MS),
          reservedOrderId: order.id,
        },
      });
      if (held.count !== 1) throw CheckoutProblems.movieUnavailable();

      if (voucher && breakdown.voucherApplied) {
        const v = voucher.row;
        const claimed = await t.voucher.updateMany({
          where: {
            id: v.id,
            active: true,
            OR: [
              { maxRedemptions: null },
              { redemptionCount: { lt: t.voucher.fields.maxRedemptions } },
            ],
          },
          data: { redemptionCount: { increment: 1 } },
        });
        if (claimed.count !== 1) throw new PriceError('VOUCHER_SOLD_OUT');
        await t.voucherRedemption.create({
          data: {
            voucherId: v.id,
            userId: buyer.user?.id ?? null,
            buyerKey,
            orderId: order.id,
            discountCents: breakdown.discountCents,
          },
        });
      }
      if (qj && breakdown.queueJumpTier) await qj.allocate(order.id);

      await audit(
        {
          action: 'order.create',
          actor: buyer.user ? { id: buyer.user.id, role: buyer.user.role } : null,
          requestId: buyer.requestId,
          targetType: 'Order',
          targetId: order.id,
          metadata: {
            kind: 'MOVIE',
            totalCents: order.totalCents,
            voucher: breakdown.voucherApplied,
            queueJumpTier: breakdown.queueJumpTier?.id ?? null,
            guest: !buyer.user,
          },
        },
        t,
      );
      return { order, payment, description: `Wiski · Patrocínio ${order.publicCode}` };
    });
  } catch (err) {
    if (err instanceof HttpError && err.code === 'VOUCHER_INVALID') await voucherFailed(coolKeys);
    throw err;
  }
  return finish(buyer, buyerKey, prepared, accessToken, now);
}

/** "Contribuir" — any whole-real amount ≥ R$ 5 towards a series/franchise campaign (11 §2.2). */
export async function createContribution(
  buyer: Buyer,
  campaignId: string,
  input: ContributionInput,
  now = new Date(),
): Promise<NextResponse> {
  const { rs, legal } = await gate();
  const { contactEmail, buyerKey } = resolveBuyer(buyer.user, input);
  checkLegal(legal, input.legal);
  const again = await replay(buyerKey, buyer.idempotencyKey);
  if (again) return respond(buyer, again.orderId, again.body);
  await buyerRateLimit(buyerKey);

  const campaign = await db().campaign.findUnique({
    where: { id: campaignId },
    include: { item: true },
  });
  if (!campaign || !['ACTIVE', 'FUNDED'].includes(campaign.item.status)) throw Problems.notFound();
  const check = checkContribution(rs.config, input.amountCents, campaign.remainingCents);
  if (!check.ok && check.code === 'AMOUNT_INVALID') throw CheckoutProblems.amountInvalid();
  if (campaignState(campaign, now) !== 'OPEN' || campaign.item.status !== 'ACTIVE') {
    throw CheckoutProblems.campaignClosed();
  }
  if (!check.ok) throw CheckoutProblems.aboveRemaining(campaign.remainingCents);
  const accessToken = newAccessToken();
  const amount = check.amountCents;

  const prepared = await inTx(async (t) => {
    await lockIp(t, buyer.ipKey);
    const { order, payment } = await newOrderRows(t, {
      kind: 'CONTRIBUTION',
      item: campaign.item,
      buyer,
      contactEmail,
      buyerKey,
      accessToken,
      legal,
      input,
      amounts: {
        breakdown: [
          { key: 'contribution', label: 'Contribuição', cents: amount },
          { key: 'total', label: 'Total', cents: amount },
        ],
        subtotalCents: amount,
        discountCents: 0,
        queueJumpCents: 0,
        totalCents: amount,
      },
      campaignId: campaign.id,
      now,
    });
    // No overfunding (11 §7): the conditional decrement either fits or fails.
    const held = await t.campaign.updateMany({
      where: {
        id: campaign.id,
        status: 'OPEN',
        deadlineAt: { gt: now },
        remainingCents: { gte: amount },
      },
      data: {
        remainingCents: { decrement: amount },
        reservedCents: { increment: amount },
        version: { increment: 1 },
      },
    });
    if (held.count !== 1) {
      const fresh = await t.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
      if (campaignState(fresh, now) !== 'OPEN') throw CheckoutProblems.campaignClosed();
      throw CheckoutProblems.aboveRemaining(fresh.remainingCents);
    }
    await audit(
      {
        action: 'order.create',
        actor: buyer.user ? { id: buyer.user.id, role: buyer.user.role } : null,
        requestId: buyer.requestId,
        targetType: 'Order',
        targetId: order.id,
        metadata: {
          kind: 'CONTRIBUTION',
          totalCents: amount,
          voucher: false,
          queueJumpTier: null,
          guest: !buyer.user,
        },
      },
      t,
    );
    return { order, payment, description: `Wiski · Contribuição ${order.publicCode}` };
  });
  return finish(buyer, buyerKey, prepared, accessToken, now);
}

export type { PricingConfig };
