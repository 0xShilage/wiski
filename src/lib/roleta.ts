/**
 * Roleta, the wheel of fortune (2026-11-04): the prizes, their odds and the wheel's slices.
 * Shared by the server (the draw) and the page (the wheel and the odds table). No zod, no I/O.
 *
 * The odds are exact: one draw is a uniform integer in [0, ROLETA_DRAW_SPACE) and each prize owns
 * a fixed number of those values (15 000 = the least common multiple of 150, 500, 1 000, 2 500).
 */
export type RoletaPrize = 'NADA' | 'FILME' | 'DOIS_FILMES' | 'VIP_TWITCH' | 'CUPOM_30';
export type RoletaPrizeStatus = 'PENDING' | 'DELIVERED' | 'CANCELLED';

export const ROLETA_SPINS_PER_DAY = 5;
/** the spins renew every day at this hour, America/Sao_Paulo */
export const ROLETA_RESET_HOUR = 17;
export const ROLETA_DRAW_SPACE = 15_000;
/** a coupon won on the wheel: 30 % off one movie, valid for this many days */
export const ROLETA_COUPON_BPS = 3_000;
export const ROLETA_COUPON_DAYS = 30;

/** 1 in N for each prize; everything else is "Nada". */
export const ROLETA_ODDS: { prize: Exclude<RoletaPrize, 'NADA'>; oneIn: number }[] = [
  { prize: 'CUPOM_30', oneIn: 150 },
  { prize: 'FILME', oneIn: 500 },
  { prize: 'DOIS_FILMES', oneIn: 1_000 },
  { prize: 'VIP_TWITCH', oneIn: 2_500 },
];

export const PRIZE_LABEL: Record<RoletaPrize, string> = {
  NADA: 'Nada',
  FILME: 'Filme grátis',
  DOIS_FILMES: 'Dois filmes grátis',
  VIP_TWITCH: 'VIP na Twitch',
  CUPOM_30: 'Cupom de 30%',
};

/** Short labels for the wheel's slices. */
export const SLICE_LABEL: Record<RoletaPrize, string> = {
  NADA: 'Nada',
  FILME: 'Filme grátis',
  DOIS_FILMES: '2 filmes',
  VIP_TWITCH: 'VIP Twitch',
  CUPOM_30: 'Cupom 30%',
};

/** The wheel, clockwise from the top: four prizes, five "Nada" (same slices as the DB CHECK). */
export const ROLETA_SLICES: readonly RoletaPrize[] = [
  'FILME',
  'NADA',
  'CUPOM_30',
  'NADA',
  'VIP_TWITCH',
  'NADA',
  'DOIS_FILMES',
  'NADA',
  'NADA',
];
export const NADA_SLOTS = ROLETA_SLICES.flatMap((p, i) => (p === 'NADA' ? [i] : []));

/** The prize for a draw value in [0, ROLETA_DRAW_SPACE). */
export function prizeForDraw(value: number): RoletaPrize {
  if (!Number.isInteger(value) || value < 0 || value >= ROLETA_DRAW_SPACE) {
    throw new RangeError('draw out of range');
  }
  let edge = 0;
  for (const { prize, oneIn } of ROLETA_ODDS) {
    edge += ROLETA_DRAW_SPACE / oneIn;
    if (value < edge) return prize;
  }
  return 'NADA';
}

/** The slice for a prize ("Nada": one of its five, picked by `nadaPick` in 0…4). */
export function slotForPrize(prize: RoletaPrize, nadaPick = 0): number {
  if (prize === 'NADA')
    return NADA_SLOTS[((nadaPick % NADA_SLOTS.length) + NADA_SLOTS.length) % NADA_SLOTS.length]!;
  return ROLETA_SLICES.indexOf(prize);
}

/** "1 em 150 (0,67%)" */
export function oddsText(oneIn: number): string {
  const pct = 100 / oneIn;
  return `1 em ${oneIn.toLocaleString('pt-BR')} (${pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%)`;
}

/** Chance of "Nada" on one spin, in percent. */
export function nadaPercent(): number {
  const won = ROLETA_ODDS.reduce((s, o) => s + ROLETA_DRAW_SPACE / o.oneIn, 0);
  return (100 * (ROLETA_DRAW_SPACE - won)) / ROLETA_DRAW_SPACE;
}

const BRT_OFFSET_MS = 3 * 3_600_000; // America/Sao_Paulo: fixed −03:00 (no DST since 2019)
const DAY_MS = 86_400_000;

/**
 * The spin period of an instant: periods start every day at 17:00 BRT; the period is named by
 * the BRT calendar day it started on (a Date at UTC midnight, as Postgres DATE values come back).
 */
export function roletaPeriod(now: Date): Date {
  const shifted = new Date(now.getTime() - BRT_OFFSET_MS - ROLETA_RESET_HOUR * 3_600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** When the spins renew next (the start of the following period). */
export function nextRoletaReset(now: Date): Date {
  const period = roletaPeriod(now);
  return new Date(period.getTime() + DAY_MS + ROLETA_RESET_HOUR * 3_600_000 + BRT_OFFSET_MS);
}

/** "hoje às 17h" / "amanhã às 17h" / "05/11 às 17h", in BRT. */
export function nextResetText(nextAt: string | Date, now: Date = new Date()): string {
  const at = typeof nextAt === 'string' ? new Date(nextAt) : nextAt;
  const day = (d: Date) => Math.floor((d.getTime() - BRT_OFFSET_MS) / DAY_MS);
  const diff = day(at) - day(now);
  if (diff <= 0) return `hoje às ${ROLETA_RESET_HOUR}h`;
  if (diff === 1) return `amanhã às ${ROLETA_RESET_HOUR}h`;
  const local = new Date(at.getTime() - BRT_OFFSET_MS);
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm} às ${ROLETA_RESET_HOUR}h`;
}
