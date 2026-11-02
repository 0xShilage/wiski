/** Client-safe shapes of the Phase 4 dashboard data (dates as ISO strings). */

export type Kind = 'MOVIE' | 'SERIES' | 'FRANCHISE';

export type AgendaEntry = {
  kind: 'ORDER' | 'CAMPAIGN';
  id: string;
  version: number;
  status: string;
  item: { id: string; kind: Kind; slug: string; title: string };
  runtimeMinutes: number;
  sponsor: string | null;
  message: string | null;
  tier: 'topo' | 'prioridade' | null;
  since: string;
  sessionId: string | null;
  publicCode: string | null;
};

export type AgendaSession = {
  id: string;
  startsAt: string;
  endsAt: string | null;
  capacityMinutes: number;
  bookedMinutes: number;
  status: 'PLANNED' | 'LIVE' | 'DONE' | 'CANCELLED';
  publicNote: string | null;
  version: number;
  nowItemId: string | null;
  nowItem: { id: string; title: string } | null;
  entries: AgendaEntry[];
};

export type AdminOrderView = {
  id: string;
  code: string;
  kind: 'MOVIE' | 'CONTRIBUTION';
  status: string;
  version: number;
  totalCents: number;
  createdAt: string;
  paidAt: string | null;
  tier: string | null;
  item: { id: string; kind: Kind; title: string; slug: string };
  session: { id: string; startsAt: string; status: string } | null;
  rescheduleCount: number | null;
  buyer: string;
  email: string | null;
  publicName: string | null;
  anonymous: boolean;
  guestDisplayName: string | null;
  displayNameStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  sponsorMessage: string | null;
  messageStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  shownMessage: string | null;
  payment: {
    status: string;
    detail: string | null;
    providerId: string | null;
    approvedAt: string | null;
  } | null;
};

export type AdminUserView = {
  id: string;
  username: string | null;
  avatarKey: string;
  role: 'USER' | 'MODERATOR' | 'STREAMER';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  suspendedUntil: string | null;
  isVip: boolean;
  createdAt: string;
  email: string | null;
  reviewCount: number;
  orderCount: number;
};

export const ORDER_STATUS_PT: Record<string, string> = {
  PENDING_PAYMENT: 'Aguardando Pix',
  PAID: 'Pago · na fila',
  SCHEDULED: 'Agendado',
  WATCHING: 'Passando agora',
  COMPLETED: 'Assistido',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
  NEEDS_ATTENTION: 'Precisa de atenção',
  REFUND_PENDING: 'Reembolso pedido',
  REFUNDED: 'Reembolsado',
};

export const WIDGET_PT = {
  agora: 'Agora assistindo',
  fila: 'Próximos da fila',
  meta: 'Meta',
  'meta-total': 'Meta total',
  patrocinio: 'Novo patrocínio',
} as const;

export const METRIC_PT = {
  SPONSORSHIP_COUNT: 'Patrocínios e contribuições (quantidade)',
  SPONSORSHIP_REVENUE_CENTS: 'Arrecadação (mostrada só em %)',
  WATCHED_MINUTES: 'Minutos assistidos na live',
} as const;

const dt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
export const fmtDateTime = (iso: string) => dt.format(new Date(iso));

/** "2026-11-03T20:00" in São Paulo time for <input type="datetime-local">, and back. */
export function toLocalInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3_600_000);
  return d.toISOString().slice(0, 16);
}
export function fromLocalInput(v: string): string {
  return new Date(`${v}:00.000-03:00`).toISOString();
}
