/**
 * Business calendar (01 §5): times are UTC in the database, business rules use the calendar of
 * America/Sao_Paulo. Pure helpers, no I/O.
 */
const TZ = 'America/Sao_Paulo';
const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar day in São Paulo as "YYYY-MM-DD". */
export function businessDay(at: Date): string {
  return ymd.format(at); // en-CA formats as YYYY-MM-DD
}

/** The same day as a Date at 00:00 UTC (what a Postgres `date` column stores via Prisma). */
export function businessDayDate(at: Date): Date {
  return new Date(`${businessDay(at)}T00:00:00.000Z`);
}

/** ISO-8601 week of the São Paulo calendar day, e.g. "2026-W43" (weeks start Monday). */
export function isoWeek(at: Date): string {
  const [y, m, d] = businessDay(at).split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dow); // Thursday of this week decides the year
  const year = date.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((date.getTime() - jan1) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
