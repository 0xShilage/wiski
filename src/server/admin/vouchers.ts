import 'server-only';
import type { Role, VoucherKind } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { db } from '../db';
import { pgErrorCode, PG } from '../db-errors';
import { HttpError, Problems } from '../http/problem';

/** Vouchers (04 §6) — the streamer creates and ends them (step-up); checkout redeems them. */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

export type VoucherInput = {
  code: string;
  kind: VoucherKind;
  percentBps?: number | null | undefined;
  amountCents?: number | null | undefined;
  maxDiscountCents?: number | null | undefined;
  minSubtotalCents?: number | null | undefined;
  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;
  maxRedemptions?: number | null | undefined;
  maxPerUser: number;
};

function view(v: Awaited<ReturnType<ReturnType<typeof db>['voucher']['findUniqueOrThrow']>>) {
  return {
    id: v.id,
    code: v.code,
    kind: v.kind,
    percentBps: v.percentBps,
    amountCents: v.amountCents,
    maxDiscountCents: v.maxDiscountCents,
    minSubtotalCents: v.minSubtotalCents,
    startsAt: v.startsAt?.toISOString() ?? null,
    endsAt: v.endsAt?.toISOString() ?? null,
    maxRedemptions: v.maxRedemptions,
    maxPerUser: v.maxPerUser,
    redemptionCount: v.redemptionCount,
    active: v.active,
    createdAt: v.createdAt.toISOString(),
  };
}

export async function listVouchers() {
  const rows = await db().voucher.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map(view);
}

export async function createVoucher(ctx: Ctx, input: VoucherInput) {
  const code = input.code.trim().toUpperCase();
  if (input.kind === 'PERCENT' && !input.percentBps) {
    throw Problems.validation([{ path: 'percentBps', message: 'Informe a porcentagem.' }]);
  }
  if (input.kind === 'FIXED' && !input.amountCents) {
    throw Problems.validation([{ path: 'amountCents', message: 'Informe o valor.' }]);
  }
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
    throw Problems.validation([{ path: 'endsAt', message: 'O fim precisa ser depois do início.' }]);
  }
  try {
    return await db().$transaction(async (t) => {
      const v = await t.voucher.create({
        data: {
          code,
          kind: input.kind,
          percentBps: input.kind === 'PERCENT' ? input.percentBps! : null,
          amountCents: input.kind === 'FIXED' ? input.amountCents! : null,
          maxDiscountCents: input.maxDiscountCents ?? null,
          minSubtotalCents: input.minSubtotalCents ?? null,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          maxRedemptions: input.maxRedemptions ?? null,
          maxPerUser: input.maxPerUser,
        },
      });
      await audit(
        { action: 'voucher.create', actor: ctx.actor, requestId: ctx.requestId, targetType: 'Voucher', targetId: v.id, metadata: { kind: v.kind, maxRedemptions: v.maxRedemptions } },
        t,
      );
      return view(v);
    });
  } catch (err) {
    if (pgErrorCode(err) === PG.uniqueViolation || (err as { code?: string }).code === 'P2002') {
      throw new HttpError(409, 'VOUCHER_EXISTS', 'Já existe um cupom com este código.');
    }
    throw err;
  }
}

export async function updateVoucher(
  ctx: Ctx,
  id: string,
  input: { active?: boolean | undefined; endsAt?: Date | null | undefined; maxRedemptions?: number | null | undefined },
) {
  const fields = (['active', 'endsAt', 'maxRedemptions'] as const).filter((k) => input[k] !== undefined);
  return db().$transaction(async (t) => {
    const v = await t.voucher.findUnique({ where: { id } });
    if (!v) throw Problems.notFound();
    if (input.maxRedemptions !== undefined && input.maxRedemptions !== null && input.maxRedemptions < v.redemptionCount) {
      throw Problems.validation([{ path: 'maxRedemptions', message: 'Menor que os usos já feitos.' }]);
    }
    const u = await t.voucher.update({
      where: { id },
      data: {
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
      },
    });
    await audit(
      { action: 'voucher.update', actor: ctx.actor, requestId: ctx.requestId, targetType: 'Voucher', targetId: id, metadata: { fields: [...fields] } },
      t,
    );
    return view(u);
  });
}
