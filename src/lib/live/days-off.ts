/**
 * "Dias sem live" (2026-11-13): the shape the Agenda and the Cronograma share, the reasons' words
 * and how a stretch of days reads ("sexta, 14/11" or "de 14/11 a 17/11").
 */
export type DayOffReason = 'FOLGA' | 'VIAGEM' | 'OUTRO';

export type DayOff = {
  id: string;
  /** YYYY-MM-DD, São Paulo calendar days, inclusive */
  startsOn: string;
  endsOn: string;
  reason: DayOffReason;
  note: string | null;
};

export const DAY_OFF_LABEL: Record<DayOffReason, string> = {
  FOLGA: 'Folga',
  VIAGEM: 'Viagem',
  OUTRO: 'Sem live',
};

export const DAY_OFF_ICON: Record<DayOffReason, string> = {
  FOLGA: '☕',
  VIAGEM: '✈',
  OUTRO: '☾',
};

const shortFmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC', // the strings are already calendar days
});
const at = (day: string) => new Date(`${day}T12:00:00Z`);
const short = (day: string) => shortFmt.format(at(day)).replace('.,', ',');

/** "sex, 14/11" for one day; "de sex, 14/11 a seg, 17/11" for a stretch. */
export function dayOffRange(d: Pick<DayOff, 'startsOn' | 'endsOn'>): string {
  if (d.startsOn === d.endsOn) return short(d.startsOn);
  return `de ${short(d.startsOn)} a ${short(d.endsOn)}`;
}

/** How many days the stretch covers. */
export function dayOffLength(d: Pick<DayOff, 'startsOn' | 'endsOn'>): number {
  return Math.round((at(d.endsOn).getTime() - at(d.startsOn).getTime()) / 86_400_000) + 1;
}

/** Whether the stretch covers this calendar day (YYYY-MM-DD). */
export function coversDay(d: Pick<DayOff, 'startsOn' | 'endsOn'>, day: string): boolean {
  return d.startsOn <= day && day <= d.endsOn;
}

const dayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** The São Paulo calendar day (YYYY-MM-DD) of an instant. */
export const saoPauloDay = (iso: string | Date) => dayKey.format(new Date(iso));
