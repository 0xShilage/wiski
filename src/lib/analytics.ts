/**
 * Admin › Análise (2026-11-04): the period presets and how a period splits into chart buckets
 * (days, weeks or months in São Paulo). Pure and client-safe.
 */
export const ANALYTICS_PERIODS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
  { days: 365, label: '12 meses' },
] as const;
export type AnalyticsDays = (typeof ANALYTICS_PERIODS)[number]['days'];

export function parseDays(raw: unknown): AnalyticsDays {
  const n = Number(raw);
  return (ANALYTICS_PERIODS.find((p) => p.days === n)?.days ?? 30) as AnalyticsDays;
}

export type Granularity = 'day' | 'week' | 'month';
export function granularityOf(days: AnalyticsDays): Granularity {
  return days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
}

const BRT_OFFSET_MS = 3 * 3_600_000; // America/Sao_Paulo: fixed −03:00 (no DST since 2019)
const DAY_MS = 86_400_000;

/** midnight BRT of the day containing `t` (as a UTC instant) */
function brtMidnight(t: number): number {
  return Math.floor((t - BRT_OFFSET_MS) / DAY_MS) * DAY_MS + BRT_OFFSET_MS;
}

export type Bucket = { start: number; end: number; label: string };

/**
 * The buckets covering the last `days` days up to `now` (oldest first). Days: one per BRT day;
 * weeks: Monday-based; months: calendar months. The first bucket may start before the period.
 */
export function bucketsFor(days: AnalyticsDays, now: Date): Bucket[] {
  const g = granularityOf(days);
  const from = brtMidnight(now.getTime()) - (days - 1) * DAY_MS;
  const out: Bucket[] = [];
  const two = (n: number) => String(n).padStart(2, '0');
  if (g === 'day') {
    for (let s = from; s <= now.getTime(); s += DAY_MS) {
      const d = new Date(s - BRT_OFFSET_MS);
      out.push({
        start: s,
        end: s + DAY_MS,
        label: `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`,
      });
    }
    return out;
  }
  if (g === 'week') {
    const d0 = new Date(from - BRT_OFFSET_MS);
    const monday = from - ((d0.getUTCDay() + 6) % 7) * DAY_MS;
    for (let s = monday; s <= now.getTime(); s += 7 * DAY_MS) {
      const d = new Date(s - BRT_OFFSET_MS);
      out.push({
        start: s,
        end: s + 7 * DAY_MS,
        label: `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`,
      });
    }
    return out;
  }
  const MONTHS = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ];
  const d0 = new Date(from - BRT_OFFSET_MS);
  let y = d0.getUTCFullYear();
  let m = d0.getUTCMonth();
  for (;;) {
    const s = Date.UTC(y, m, 1) + BRT_OFFSET_MS;
    if (s > now.getTime()) break;
    const e = Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, 1) + BRT_OFFSET_MS;
    out.push({ start: s, end: e, label: `${MONTHS[m]}/${String(y).slice(2)}` });
    if (m === 11) {
      m = 0;
      y += 1;
    } else m += 1;
  }
  return out;
}

/** The start of the period (the first instant of its first day, BRT). */
export function periodStart(days: AnalyticsDays, now: Date): Date {
  return new Date(brtMidnight(now.getTime()) - (days - 1) * DAY_MS);
}

/** Sum values into buckets by time (values outside every bucket are dropped). */
export function bucketSums(buckets: Bucket[], rows: { at: number; value: number }[]): number[] {
  const sums = buckets.map(() => 0);
  for (const r of rows) {
    const i = buckets.findIndex((b) => r.at >= b.start && r.at < b.end);
    if (i >= 0) sums[i]! += r.value;
  }
  return sums;
}

/** Change vs the previous period: +25 (%), null when there was nothing before. */
export function changePercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Clean axis ticks from 0 to ≥ max: 0, 50, 100… (4–6 steps). */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}
