import { formatBRL, formatRuntime } from '@/lib/catalog/pricing';
import type { PricingConfig, QueueJumpTier } from './config';

/**
 * The price engine (04 §4). Pure and deterministic: `priceMovie(config, input, context)` →
 * breakdown or a typed error. No I/O — the buyer's perk, the voucher row and its usage counts,
 * and queue-jump availability are passed in. Integer cents only; every percentage is rounded half
 * up at the line where it is applied and lines are summed as integers, so the shown lines always
 * add up to the charged total.
 */

export type PriceErrorCode =
  | 'KIND_DISABLED'
  | 'RUNTIME_UNKNOWN'
  | 'RUNTIME_OUT_OF_RANGE'
  | 'ADDON_INVALID'
  | 'VOUCHER_INVALID'
  | 'VOUCHER_EXPIRED'
  | 'VOUCHER_SOLD_OUT'
  | 'VOUCHER_USER_LIMIT'
  | 'QUEUE_JUMP_DISABLED'
  | 'QUEUE_JUMP_TIER_INVALID'
  | 'QUEUE_JUMP_SOLD_OUT'
  | 'QUEUE_JUMP_BUYER_LIMIT'
  | 'TOTAL_ABOVE_LIMIT'
  | 'TOTAL_BELOW_LIMIT';

export class PriceError extends Error {
  constructor(readonly code: PriceErrorCode) {
    super(code);
    this.name = 'PriceError';
  }
}

export type BreakdownLine = {
  /** stable machine key: runtime | base | extra | addon:<id> | subtotal | discount | queue-jump | total */
  key: string;
  label: string;
  /** null for informational lines (runtime) */
  cents: number | null;
};

export type Perk = 'NONE' | 'MODERATOR' | 'VIP';

/** Voucher as stored, plus its usage numbers (read in the same transaction as the reservation). */
export type VoucherContext = {
  code: string;
  kind: 'PERCENT' | 'FIXED';
  percentBps: number | null;
  amountCents: number | null;
  maxDiscountCents: number | null;
  minSubtotalCents: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  maxPerUser: number;
  /** RESERVED + CONSUMED redemptions by this buyer */
  buyerRedemptions: number;
};

export type QueueJumpAvailability = {
  /** the shared daily/weekly caps or this tier's own cap have no free slot */
  soldOut: boolean;
  /** this buyer already used perBuyerDailyCap jumps today */
  buyerLimitReached: boolean;
};

export type MovieInput = {
  runtimeMinutes: number | null;
  addOnIds?: readonly string[];
  queueJumpTierId?: string | null;
  /**
   * The movie's price set by hand in the dashboard (2026-11-02): replaces the runtime formula
   * (base band + extra minutes). Add-ons, discounts and queue jumps still apply on top of it.
   */
  baseOverrideCents?: number | null;
};

export type PriceContext = {
  perk: Perk;
  /** null = no code typed; a typed code that matches nothing is VOUCHER_INVALID before this */
  voucher: VoucherContext | null;
  /** required when a tier is chosen */
  queueJump?: QueueJumpAvailability;
  now: Date;
};

export type Breakdown = {
  lines: BreakdownLine[];
  runtimeMinutes: number;
  baseCents: number;
  extraCents: number;
  addOnCents: number;
  subtotalCents: number;
  discountCents: number;
  discountSource: 'MODERATOR' | 'VIP' | 'VOUCHER' | null;
  /** the voucher is consumed only when it gave the discount (04 §4 step 5) */
  voucherApplied: boolean;
  queueJumpCents: number;
  queueJumpTier: Pick<QueueJumpTier, 'id' | 'label' | 'bps' | 'placement'> | null;
  totalCents: number;
};

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function assertCents(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(`not a non-negative safe integer: ${n}`);
  return n;
}

/** mulBps(a, bps) = floor((a × bps + 5000) / 10000): round half up to the cent (04 §4). */
export function mulBps(a: number, bps: number): number {
  assertCents(a);
  assertCents(bps);
  const product = a * bps;
  if (product + 5000 > MAX_SAFE) throw new RangeError('mulBps overflow');
  return Math.floor((product + 5000) / 10000);
}

/** "+80 %" (pt-BR, integer or one decimal). */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1).replace('.', ',')} %`;
}

function voucherDiscount(v: VoucherContext, subtotal: number, now: Date): number {
  if (!v.active) throw new PriceError('VOUCHER_INVALID');
  if ((v.startsAt && now < v.startsAt) || (v.endsAt && now >= v.endsAt)) {
    throw new PriceError('VOUCHER_EXPIRED');
  }
  if (v.maxRedemptions !== null && v.redemptionCount >= v.maxRedemptions) {
    throw new PriceError('VOUCHER_SOLD_OUT');
  }
  if (v.buyerRedemptions >= v.maxPerUser) throw new PriceError('VOUCHER_USER_LIMIT');
  if (v.minSubtotalCents !== null && subtotal < v.minSubtotalCents) {
    throw new PriceError('VOUCHER_INVALID');
  }
  if (v.kind === 'PERCENT') {
    if (v.percentBps === null) throw new PriceError('VOUCHER_INVALID');
    const d = mulBps(subtotal, v.percentBps);
    return v.maxDiscountCents === null ? d : Math.min(d, v.maxDiscountCents);
  }
  if (v.amountCents === null) throw new PriceError('VOUCHER_INVALID');
  return Math.min(v.amountCents, subtotal);
}

export function priceMovie(config: PricingConfig, input: MovieInput, ctx: PriceContext): Breakdown {
  const rule = config.kinds.MOVIE;
  if (!rule.enabled) throw new PriceError('KIND_DISABLED');

  // 0. runtime
  const R = input.runtimeMinutes;
  if (R === null || R === undefined) throw new PriceError('RUNTIME_UNKNOWN');
  if (!Number.isInteger(R) || R < rule.minRuntimeMinutes || R > rule.maxRuntimeMinutes) {
    throw new PriceError('RUNTIME_OUT_OF_RANGE');
  }
  const lines: BreakdownLine[] = [
    { key: 'runtime', label: `Duração: ${formatRuntime(R)}`, cents: null },
  ];

  // 1. base — the manual price, or the first band with R ≤ upToMinutes, else the last band
  const { bands, perMinuteOverCents } = rule.pricing;
  const last = bands[bands.length - 1]!;
  const band = bands.find((b) => R <= b.upToMinutes) ?? last;
  const manual = input.baseOverrideCents ?? null;
  const B = assertCents(manual ?? band.baseCents);
  lines.push({ key: 'base', label: 'Filme', cents: B });

  // 2. extra minutes above the last band (none with a manual price)
  const extraMinutes = manual === null ? Math.max(0, R - last.upToMinutes) : 0;
  const X = assertCents(extraMinutes * perMinuteOverCents);
  if (X > 0) {
    lines.push({
      key: 'extra',
      label: `Minutos adicionais (${extraMinutes} × ${formatBRL(perMinuteOverCents)})`,
      cents: X,
    });
  }

  // 3. add-ons
  let A = 0;
  const seen = new Set<string>();
  for (const id of input.addOnIds ?? []) {
    const addOn = config.addOns.find((a) => a.id === id && a.active && a.kinds.includes('MOVIE'));
    if (!addOn || seen.has(id)) throw new PriceError('ADDON_INVALID');
    seen.add(id);
    const c =
      addOn.pricing.type === 'FIXED' ? addOn.pricing.cents : mulBps(B + X, addOn.pricing.bps);
    A += assertCents(c);
    lines.push({ key: `addon:${id}`, label: addOn.label, cents: c });
  }

  // 4. subtotal
  const S = assertCents(B + X + A);
  lines.push({ key: 'subtotal', label: 'Subtotal', cents: S });

  // 5. discount — best single of perk and voucher; tie → perk (voucher not consumed)
  const perkBps =
    ctx.perk === 'MODERATOR'
      ? config.discounts.moderatorBps
      : ctx.perk === 'VIP'
        ? config.discounts.vipBps
        : 0;
  const perk = perkBps > 0 ? mulBps(S, perkBps) : 0;
  const voucher = ctx.voucher ? voucherDiscount(ctx.voucher, S, ctx.now) : 0;
  let D = Math.max(perk, voucher);
  let source: Breakdown['discountSource'] = null;
  if (D > 0) source = perk >= voucher ? (ctx.perk === 'VIP' ? 'VIP' : 'MODERATOR') : 'VOUCHER';
  D = Math.min(D, Math.max(0, S - config.minTotalCents)); // clamp: S − D ≥ minTotalCents
  if (D === 0) source = null;
  if (D > 0) {
    lines.push({
      key: 'discount',
      label:
        source === 'VOUCHER'
          ? `Cupom ${ctx.voucher!.code}`
          : source === 'VIP'
            ? 'Desconto VIP'
            : 'Desconto moderador',
      cents: -D,
    });
  }

  // 6. queue jump on S (pre-discount); never discounted
  let Q = 0;
  let tier: Breakdown['queueJumpTier'] = null;
  if (input.queueJumpTierId) {
    if (!config.queueJump.enabled) throw new PriceError('QUEUE_JUMP_DISABLED');
    const t = config.queueJump.tiers.find((x) => x.id === input.queueJumpTierId);
    if (!t) throw new PriceError('QUEUE_JUMP_TIER_INVALID');
    if (!ctx.queueJump) throw new Error('queue-jump availability missing');
    if (ctx.queueJump.buyerLimitReached) throw new PriceError('QUEUE_JUMP_BUYER_LIMIT');
    if (ctx.queueJump.soldOut) throw new PriceError('QUEUE_JUMP_SOLD_OUT');
    Q = mulBps(S, t.bps);
    tier = { id: t.id, label: t.label, bps: t.bps, placement: t.placement };
    lines.push({ key: 'queue-jump', label: `${t.label} (+${formatBps(t.bps)})`, cents: Q });
  }

  // 7. total
  const T = S - D + Q;
  if (T < config.minTotalCents) throw new PriceError('TOTAL_BELOW_LIMIT');
  if (T > config.maxTotalCents) throw new PriceError('TOTAL_ABOVE_LIMIT');
  lines.push({ key: 'total', label: 'Total', cents: T });

  return {
    lines,
    runtimeMinutes: R,
    baseCents: B,
    extraCents: X,
    addOnCents: A,
    subtotalCents: S,
    discountCents: D,
    discountSource: source,
    voucherApplied: source === 'VOUCHER',
    queueJumpCents: Q,
    queueJumpTier: tier,
    totalCents: T,
  };
}

export type ContributionCheck =
  | { ok: true; amountCents: number }
  | { ok: false; code: 'AMOUNT_INVALID' | 'AMOUNT_ABOVE_REMAINING'; remainingCents?: number };

/**
 * Contributions (11 §2.2): whole reais ≥ R$ 5, ≤ the campaign's remaining amount. No perks.
 * (A last gap below R$ 5 is closed by the streamer lowering the goal to the amount raised.)
 */
export function checkContribution(
  config: PricingConfig,
  amountCents: number,
  remainingCents: number,
): ContributionCheck {
  const c = config.contributions;
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents < c.minCents ||
    amountCents > c.maxCents ||
    amountCents % c.stepCents !== 0
  ) {
    return { ok: false, code: 'AMOUNT_INVALID' };
  }
  if (amountCents > remainingCents) {
    return { ok: false, code: 'AMOUNT_ABOVE_REMAINING', remainingCents };
  }
  return { ok: true, amountCents };
}
