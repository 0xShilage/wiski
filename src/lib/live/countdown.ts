/**
 * "Em breve" countdown (2026-11-11): the time left until a live, split for the display, and the
 * sentence screen readers get. Pure, so the server and the browser compute the same thing.
 */
export type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** the start time has come (or passed: the live may just be late) */
  done: boolean;
};

export function countdownParts(targetMs: number, nowMs: number): CountdownParts {
  const left = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  return {
    days: Math.floor(left / 86_400),
    hours: Math.floor((left % 86_400) / 3_600),
    minutes: Math.floor((left % 3_600) / 60),
    seconds: left % 60,
    done: left === 0,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Começa em 2 dias, 4 horas e 31 minutos" — to the minute, so it doesn't change every second. */
export function countdownSentence(p: CountdownParts): string {
  if (p.done) return 'Começa a qualquer momento';
  const parts = [
    p.days ? plural(p.days, 'dia', 'dias') : null,
    p.hours ? plural(p.hours, 'hora', 'horas') : null,
    p.minutes ? plural(p.minutes, 'minuto', 'minutos') : null,
  ].filter((x): x is string => x !== null);
  if (!parts.length) return 'Começa em menos de um minuto';
  const last = parts.pop()!;
  return `Começa em ${parts.length ? `${parts.join(', ')} e ${last}` : last}`;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
