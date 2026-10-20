import { formatBRL, formatRuntime } from '@/lib/catalog/pricing';
import type { PricingConfig, QueueJumpTier } from './config';

/**
 * The price engine (04 §4) — pure, deterministic, integers only. The server computes every price;
 * the client only sends selections. Lines appear in the canonical order and always add up to the
 * total. No I/O here: the buyer's perk and the voucher's terms are passed in by the caller, which
 * read them from the database (never from the request).
 */

export type Perk = 'MODERATOR' | 'VIP' | null;

/** A voucher the caller has already found active, in its window and within its limits. */
export type VoucherTerms = {
  code: string;
  kind: 'PERCENT' | 'FIXED';
  percentBps: number | null;
  amountCents: number | null;
  maxDiscountCents: number | null;
  minSubtotalCents: number | null;
};

export type PriceInput = {
  runtimeMinutes: number;
  queueJumpTierId: string | null;
  voucher: VoucherTerms | null;
  perk: Perk;
};

export type LineKind = 'info' | 'base' | 'extra' | 'subtotal' | 'discount' | 'queueJump' | 'total';
export type PriceLine = { kind: LineKind; label: string; cents: number | null };

export type Breakdown = {
  lines: PriceLine[];
  subtotalCents: number;
  discountCents: number;
  discountSource: 'PERK' | 'VOUCHER' | null;
  /** true only when the voucher is what the buyer pays less with (then it gets reserved) */
  voucherApplied: boolean;
  queueJumpCents: number;
  totalCents: number;
  tier: Pick<QueueJumpTier, 'id' | 'label' | 'bps' | 'placement'> | null;
};

export type PriceErrorCode =
  | 'RUNTIME_OUT_OF_RANGE'
  | 'QUEUE_JUMP_DISABLED'
  | 'QUEUE_JUMP_TIER_INVALID'
  | 'VOUCHER_MIN_SUBTOTAL'
  | 'TOTAL_BELOW_MIN'
  | 'TOTAL_ABOVE_LIMIT';

export class PriceError extends Error {
  constructor(readonly code: PriceErrorCode) {
    super(code);
    this.name = 'PriceError';
  }
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function assertCents(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`not a cents value: ${n}`);
  return n;
}

/** a × bps / 10000, rounded half up to the cent (04 §4). Both operands are non-negative. */
export function mulBps(a: number, bps: number): number {
  assertCents(a);
  if (!Number.isSafeInteger(bps) || bps < 0) throw new RangeError(`bad bps: ${bps}`);
  const product = a * bps;
  if (product + 5000 > MAX_SAFE) throw new RangeError('overflow');
  return Math.floor((product + 5000) / 10_000);
}

/** 1000 → "10 %", 1250 → "12,5 %", 8000 → "80 %" (pt-BR, no trailing zeros). */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} %`;
}

export function findTier(config: PricingConfig, id: string): QueueJumpTier | undefined {
  return config.queueJump.tiers.find((t) => t.id === id);
}

export function priceMovie(config: PricingConfig, input: PriceInput): Breakdown {
  const { movie } = config;
  const R = input.runtimeMinutes;
  if (!Number.isInteger(R) || R < movie.minRuntimeMinutes || R > movie.maxRuntimeMinutes) {
    throw new PriceError('RUNTIME_OUT_OF_RANGE');
  }

  // 1–2. base by band (inclusive upper bound), extra minutes above the LAST band
  const band = movie.bands.find((b) => R <= b.upToMinutes) ?? movie.bands[movie.bands.length - 1]!;
  const B = assertCents(band.baseCents);
  const last = movie.bands[movie.bands.length - 1]!;
  const extraMin = Math.max(0, R - last.upToMinutes);
  const X = assertCents(extraMin * movie.perMinuteOverCents);

  // 4. subtotal (no add-ons in v1)
  const S = assertCents(B + X);

  // 5. discount: best single of perk and voucher (tie → perk; the voucher is then not consumed)
  const perkBps =
    input.perk === 'MODERATOR'
      ? config.discounts.moderatorBps
      : input.perk === 'VIP'
        ? config.discounts.vipBps
        : 0;
  const perkCents = perkBps > 0 ? mulBps(S, perkBps) : 0;
  let voucherCents = 0;
  const v = input.voucher;
  if (v) {
    if (v.minSubtotalCents !== null && S < v.minSubtotalCents) {
      throw new PriceError('VOUCHER_MIN_SUBTOTAL');
    }
    voucherCents =
      v.kind === 'PERCENT'
        ? Math.min(mulBps(S, v.percentBps ?? 0), v.maxDiscountCents ?? MAX_SAFE)
        : Math.min(v.amountCents ?? 0, S);
  }
  let discountSource: Breakdown['discountSource'] = null;
  let D = 0;
  if (perkCents > 0 || voucherCents > 0) {
    if (perkCents >= voucherCents) {
      discountSource = 'PERK';
      D = perkCents;
    } else {
      discountSource = 'VOUCHER';
      D = voucherCents;
    }
  }
  // clamp so S − D ≥ minTotal (never a negative discount)
  D = Math.max(0, Math.min(D, S - config.minTotalCents));
  if (D === 0) discountSource = null;

  // 6. queue jump on the PRE-discount subtotal
  let tier: QueueJumpTier | null = null;
  if (input.queueJumpTierId !== null) {
    if (!config.queueJump.enabled) throw new PriceError('QUEUE_JUMP_DISABLED');
    tier = findTier(config, input.queueJumpTierId) ?? null;
    if (!tier) throw new PriceError('QUEUE_JUMP_TIER_INVALID');
  }
  const Q = tier ? mulBps(S, tier.bps) : 0;

  // 7. total
  const T = S - D + Q;
  if (T < config.minTotalCents) throw new PriceError('TOTAL_BELOW_MIN');
  if (T > config.maxTotalCents) throw new PriceError('TOTAL_ABOVE_LIMIT');

  const lines: PriceLine[] = [
    { kind: 'info', label: `Duração: ${formatRuntime(R)}`, cents: null },
    { kind: 'base', label: 'Filme', cents: B },
  ];
  if (X > 0) {
    lines.push({
      kind: 'extra',
      label: `Minutos adicionais (${extraMin} × ${formatBRL(movie.perMinuteOverCents)})`,
      cents: X,
    });
  }
  lines.push({ kind: 'subtotal', label: 'Subtotal', cents: S });
  if (D > 0 && discountSource === 'PERK') {
    lines.push({
      kind: 'discount',
      label: `Desconto ${input.perk === 'MODERATOR' ? 'moderador' : 'VIP'} (${formatBps(perkBps)})`,
      cents: -D,
    });
  } else if (D > 0 && discountSource === 'VOUCHER') {
    lines.push({ kind: 'discount', label: `Cupom ${v!.code}`, cents: -D });
  }
  if (v && discountSource !== 'VOUCHER') {
    lines.push({
      kind: 'info',
      label: `Cupom ${v.code} não usado: ${
        discountSource === 'PERK'
          ? 'seu desconto atual já é maior ou igual'
          : 'sem desconto neste pedido'
      }`,
      cents: null,
    });
  }
  if (tier) {
    lines.push({ kind: 'queueJump', label: `${tier.label} (+${formatBps(tier.bps)})`, cents: Q });
  }
  lines.push({ kind: 'total', label: 'Total', cents: T });

  return {
    lines,
    subtotalCents: S,
    discountCents: D,
    discountSource,
    voucherApplied: discountSource === 'VOUCHER',
    queueJumpCents: Q,
    totalCents: T,
    tier: tier
      ? { id: tier.id, label: tier.label, bps: tier.bps, placement: tier.placement }
      : null,
  };
}

/** Sum check used by tests and by the order writer: the displayed lines add up to the total. */
export function linesTotal(lines: readonly PriceLine[]): number {
  return lines
    .filter((l) => l.kind !== 'info' && l.kind !== 'subtotal' && l.kind !== 'total')
    .reduce((s, l) => s + (l.cents ?? 0), 0);
}
