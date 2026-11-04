/**
 * Subathon timer helpers without zod (2026-11-03): the OBS widget and the dashboard import these,
 * and zod must stay out of the overlay bundle (it probes for eval, which the CSP blocks). The
 * request schemas live in `./subathon`, which re-exports everything here.
 */
export const SUBATHON_MAX_SECONDS = 90 * 86_400; // 90 days: the database CHECK
export const SUBATHON_TITLE_MAX = 60;
export const DEFAULT_SECONDS_PER_REAL = 60;

export type SubathonCount = {
  /** site payments: movie sponsorships, contributions, "Já pago" */
  site: boolean;
  /** StreamElements tips */
  tips: boolean;
  bits: boolean;
  /** new subscriptions */
  subs: boolean;
  /** renewals shared in chat */
  resubs: boolean;
  prime: boolean;
  gifts: boolean;
};

export type SubathonRates = {
  /** value of 100 bits */
  bits100Cents: number;
  tier1Cents: number;
  tier2Cents: number;
  tier3Cents: number;
  primeCents: number;
  /** tips in another currency: what US$ 1 and € 1 are worth here, in R$ cents */
  usdCents: number;
  eurCents: number;
  count: SubathonCount;
};

/** Starting values; every one is editable in Admin › Subathon. */
export const DEFAULT_SUBATHON_RATES: SubathonRates = {
  bits100Cents: 500, // 100 bits = R$ 5 → 5 min
  tier1Cents: 1000, // sub Tier 1 = R$ 10 → 10 min
  tier2Cents: 2000,
  tier3Cents: 5000,
  primeCents: 1000,
  usdCents: 550, // US$ 1 ≈ R$ 5,50 (edit to today's rate)
  eurCents: 600,
  count: { site: true, tips: true, bits: true, subs: true, resubs: true, prime: true, gifts: true },
};

/** A tip's value in R$ cents: BRL as is, USD/EUR by the subathon's rates; other currencies null. */
export function tipCents(amount: number, currency: string, r: SubathonRates): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const c = currency.toUpperCase();
  if (c === 'BRL') return Math.round(amount * 100);
  if (c === 'USD') return Math.round(amount * r.usdCents);
  if (c === 'EUR') return Math.round(amount * r.eurCents);
  return null;
}

/** R$ value → seconds on the timer (rounded to the nearest second). */
export function secondsFor(valueCents: number, secondsPerReal: number): number {
  if (!Number.isFinite(valueCents) || valueCents <= 0) return 0;
  return Math.round((valueCents * secondsPerReal) / 100);
}

/** "12:05:09", or "2d 03:00:00" past a day; negative input shows as 00:00:00. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return days ? `${days}d ${clock}` : clock;
}

/** "+5:00", "+1:02:30", "−3:00" — how much an entry moved the timer. */
export function formatDelta(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+';
  const s = Math.abs(Math.round(seconds));
  const h = Math.floor(s / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${sign}${h}:${String(m).padStart(2, '0')}:${sec}` : `${sign}${m}:${sec}`;
}

/** Time left now: from endsAt while running, else the stored remainder. */
export function remainingAt(
  s: { status: string; remainingSeconds: number; endsAt: Date | string | null },
  now: number,
): number {
  if (s.status === 'RUNNING' && s.endsAt) {
    const end = typeof s.endsAt === 'string' ? Date.parse(s.endsAt) : s.endsAt.getTime();
    return Math.max(0, Math.ceil((end - now) / 1000));
  }
  return s.status === 'ENDED' ? 0 : s.remainingSeconds;
}
