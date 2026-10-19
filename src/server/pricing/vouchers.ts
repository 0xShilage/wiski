import 'server-only';
import type { Prisma, Voucher } from '@/generated/prisma/client';
import type { VoucherTerms } from '@/lib/pricing/engine';
import { db } from '../db';
import { PG, pgErrorCode } from '../db-errors';
import { HttpError } from '../http/problem';
import { logger } from '../log';
import { hit } from '../ratelimit/sliding-window';
import { redis } from '../redis';

/**
 * Vouchers (04 §6): movie orders only (11 §2.2 — never on contributions). Codes are uppercase
 * canonical [A-Z0-9-]{8,32}. Limits are race-free: `redemptionCount` moves by a conditional
 * update (and a DB CHECK caps it), per-buyer limits count RESERVED + CONSUMED redemptions.
 * Five invalid codes in 10 minutes from one IP or buyer → 15-minute cool-down.
 */
export const VOUCHER_CODE = /^[A-Z0-9-]{8,32}$/;
const COOL_DOWN_SEC = 15 * 60;
const INVALID_LIMIT = { limit: 5, windowMs: 10 * 60_000 };

export const VoucherProblems = {
  invalid: () => new HttpError(422, 'VOUCHER_INVALID', 'Cupom inválido.'),
  expired: () => new HttpError(422, 'VOUCHER_EXPIRED', 'Este cupom não está valendo agora.'),
  soldOut: () => new HttpError(409, 'VOUCHER_SOLD_OUT', 'Este cupom já foi todo usado.'),
  userLimit: () =>
    new HttpError(409, 'VOUCHER_USER_LIMIT', 'Você já usou este cupom o máximo de vezes.'),
  coolDown: () =>
    new HttpError(
      429,
      'VOUCHER_COOL_DOWN',
      'Muitos cupons inválidos. Aguarde alguns minutos e tente de novo.',
      { headers: { 'retry-after': String(COOL_DOWN_SEC) } },
    ),
};

export function normaliseVoucherCode(raw: string): string {
  return raw.normalize('NFKC').trim().toUpperCase();
}

export function termsOf(v: Voucher): VoucherTerms {
  return {
    code: v.code,
    kind: v.kind,
    percentBps: v.percentBps,
    amountCents: v.amountCents,
    maxDiscountCents: v.maxDiscountCents,
    minSubtotalCents: v.minSubtotalCents,
  };
}

async function onInvalid(ipKey: string, buyerKey: string | null): Promise<void> {
  try {
    const r = redis();
    for (const subject of [`ip:${ipKey}`, ...(buyerKey ? [`b:${buyerKey}`] : [])]) {
      const res = await hit(r, `vc:bad:${subject}`, INVALID_LIMIT.limit, INVALID_LIMIT.windowMs);
      if (!res.allowed || res.count >= INVALID_LIMIT.limit) {
        await r.set(`vc:cool:${subject}`, '1', 'EX', COOL_DOWN_SEC);
        logger.warn({ subject: subject.slice(0, 12) }, 'voucher brute-force cool-down');
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'voucher limiter down');
  }
}

async function inCoolDown(ipKey: string, buyerKey: string | null): Promise<boolean> {
  try {
    const keys = [`vc:cool:ip:${ipKey}`, ...(buyerKey ? [`vc:cool:b:${buyerKey}`] : [])];
    return (await redis().exists(...keys)) > 0;
  } catch {
    return false; // fail open on the cool-down only; limits below stay in the database
  }
}

/**
 * Find a voucher the buyer may use right now. `buyerKey` is null for an anonymous quote (no
 * e-mail yet): the per-buyer limit is then checked at checkout.
 */
export async function usableVoucher(
  rawCode: string,
  ctx: { ipKey: string; buyerKey: string | null; now?: Date },
): Promise<Voucher> {
  const now = ctx.now ?? new Date();
  if (await inCoolDown(ctx.ipKey, ctx.buyerKey)) throw VoucherProblems.coolDown();
  const code = normaliseVoucherCode(rawCode);
  const v = VOUCHER_CODE.test(code) ? await db().voucher.findUnique({ where: { code } }) : null;
  if (!v || !v.active) {
    await onInvalid(ctx.ipKey, ctx.buyerKey);
    throw VoucherProblems.invalid();
  }
  if ((v.startsAt && v.startsAt > now) || (v.endsAt && v.endsAt <= now)) {
    throw VoucherProblems.expired();
  }
  if (v.maxRedemptions !== null && v.redemptionCount >= v.maxRedemptions) {
    throw VoucherProblems.soldOut();
  }
  if (ctx.buyerKey) {
    const used = await db().voucherRedemption.count({
      where: { voucherId: v.id, buyerKey: ctx.buyerKey, status: { in: ['RESERVED', 'CONSUMED'] } },
    });
    if (used >= v.maxPerUser) throw VoucherProblems.userLimit();
  }
  return v;
}

/** Inside the order transaction: take one redemption (race-free) and record it as RESERVED. */
export async function reserveVoucher(
  tx: Prisma.TransactionClient,
  v: Voucher,
  r: { orderId: string; buyerKey: string; userId: string | null; discountCents: number },
): Promise<void> {
  const used = await tx.voucherRedemption.count({
    where: { voucherId: v.id, buyerKey: r.buyerKey, status: { in: ['RESERVED', 'CONSUMED'] } },
  });
  if (used >= v.maxPerUser) throw VoucherProblems.userLimit();
  try {
    const res = await tx.voucher.updateMany({
      where: {
        id: v.id,
        active: true,
        OR: [
          { maxRedemptions: null },
          { redemptionCount: { lt: tx.voucher.fields.maxRedemptions } },
        ],
      },
      data: { redemptionCount: { increment: 1 } },
    });
    if (res.count !== 1) throw VoucherProblems.soldOut();
  } catch (err) {
    if (pgErrorCode(err) === PG.checkViolation) throw VoucherProblems.soldOut();
    throw err;
  }
  await tx.voucherRedemption.create({
    data: {
      voucherId: v.id,
      orderId: r.orderId,
      buyerKey: r.buyerKey,
      userId: r.userId,
      discountCents: r.discountCents,
    },
  });
}

/** Expired/cancelled order: give the redemption back (idempotent). */
export async function releaseVoucher(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const red = await tx.voucherRedemption.findUnique({ where: { orderId } });
  if (!red || red.status !== 'RESERVED') return;
  const res = await tx.voucherRedemption.updateMany({
    where: { id: red.id, status: 'RESERVED' },
    data: { status: 'RELEASED' },
  });
  if (res.count === 1) {
    await tx.voucher.update({
      where: { id: red.voucherId },
      data: { redemptionCount: { decrement: 1 } },
    });
  }
}

/** Approved payment: the redemption is final (idempotent). */
export async function consumeVoucher(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.voucherRedemption.updateMany({
    where: { orderId, status: 'RESERVED' },
    data: { status: 'CONSUMED' },
  });
}
