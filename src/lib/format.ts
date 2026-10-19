/** pt-BR formatting in the business time zone (01 §5). */
const TZ = 'America/Sao_Paulo';

export const formatDateTime = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ }).format(
    d,
  );

export const formatDate = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: TZ }).format(d);

export const formatMonthYear = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: TZ }).format(d);
