/**
 * Catalog money rules shown in the dashboard and on public pages (11 §2, 04 §3). Pure and
 * client-safe. The checkout (Phase 2) computes the charged amount on the server from the active
 * PriceRuleSet; these constants mirror that rule set's rev 3 values and are covered by tests.
 */
export const MOVIE_BASE_CENTS = 2000; // R$ 20,00 …
export const MOVIE_BASE_UP_TO_MIN = 130; // … up to 2 h 10 min
export const MOVIE_PER_EXTRA_MIN_CENTS = 100; // + R$ 1,00 per extra minute
export const SEASON_GOAL_CENTS = 10000; // R$ 100,00 per season included
export const MIN_CONTRIBUTION_CENTS = 500; // R$ 5,00, whole reais
export const MOVIE_MAX_RUNTIME = 360;
export const LIVE_LIMIT = { MOVIE: 50, SERIES: 20, FRANCHISE: 10 } as const;
export const DEFAULT_CAMPAIGN_DAYS = 30;

export function moviePriceCents(runtimeMinutes: number): number {
  if (
    !Number.isInteger(runtimeMinutes) ||
    runtimeMinutes < 1 ||
    runtimeMinutes > MOVIE_MAX_RUNTIME
  ) {
    throw new RangeError('runtime out of range');
  }
  const extra = Math.max(0, runtimeMinutes - MOVIE_BASE_UP_TO_MIN);
  return MOVIE_BASE_CENTS + extra * MOVIE_PER_EXTRA_MIN_CENTS;
}

/** R$ 5,00 to R$ 2.000,00 (ci_manual_price). */
export const MANUAL_PRICE_MIN_CENTS = 500;
export const MANUAL_PRICE_MAX_CENTS = 200_000;

/** The movie's price before discounts: the manual price when the streamer set one (2026-11-02). */
export function movieListPriceCents(
  runtimeMinutes: number,
  manualPriceCents: number | null,
): number {
  return manualPriceCents ?? moviePriceCents(runtimeMinutes);
}

export function seriesGoalCents(seasonCount: number): number {
  if (!Number.isInteger(seasonCount) || seasonCount < 1) throw new RangeError('seasonCount');
  return SEASON_GOAL_CENTS * seasonCount;
}

/** Franchise goal = Σ movie price of each film (11 §2.2). */
export function franchiseGoalCents(entries: readonly { runtimeMinutes: number }[]): number {
  if (entries.length === 0) throw new RangeError('no films');
  return entries.reduce((sum, e) => sum + moviePriceCents(e.runtimeMinutes), 0);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 20,00" (non-breaking space normalised to a normal space for stable UI text). */
export function formatBRL(cents: number): string {
  return brl.format(cents / 100).replace(/\s/g, ' ');
}

/** 115 → "1 h 55 min", 90 → "1 h 30 min", 45 → "45 min", 120 → "2 h". */
export function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Percent funded, floored, 0–100 (a campaign never shows 100 % before it is complete). */
export function percentFunded(raisedCents: number, goalCents: number): number {
  if (goalCents <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((raisedCents * 100) / goalCents)));
}
