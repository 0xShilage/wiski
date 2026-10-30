/** Dates on review cards: same output on the server and in the browser (fixed time zone). */
const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

export function reviewDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

/** Length as the server counts it (code points). */
export function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
