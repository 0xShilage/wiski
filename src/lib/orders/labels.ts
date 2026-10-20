/** pt-BR labels for order states (buyer pages, Perfil, /admin/pedidos). Client-safe. */
export type OrderStatusCode =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'SCHEDULED'
  | 'WATCHING'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'NEEDS_ATTENTION'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export type Tone = 'wait' | 'ok' | 'off' | 'warn';

export const ORDER_STATUS: Record<OrderStatusCode, { label: string; tone: Tone }> = {
  PENDING_PAYMENT: { label: 'Aguardando Pix', tone: 'wait' },
  PAID: { label: 'Pago', tone: 'ok' },
  SCHEDULED: { label: 'Agendado', tone: 'ok' },
  WATCHING: { label: 'Na live', tone: 'ok' },
  COMPLETED: { label: 'Assistido', tone: 'ok' },
  EXPIRED: { label: 'Pix expirado', tone: 'off' },
  CANCELLED: { label: 'Cancelado', tone: 'off' },
  NEEDS_ATTENTION: { label: 'Em análise', tone: 'warn' },
  REFUND_PENDING: { label: 'Reembolso em andamento', tone: 'warn' },
  REFUNDED: { label: 'Reembolsado', tone: 'off' },
};

export function statusOf(code: string): { label: string; tone: Tone } {
  return ORDER_STATUS[code as OrderStatusCode] ?? { label: code, tone: 'off' };
}

export const ORDER_KIND_LABEL = { MOVIE: 'Patrocínio', CONTRIBUTION: 'Contribuição' } as const;

export const PAID_STATES: readonly string[] = ['PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED'];
