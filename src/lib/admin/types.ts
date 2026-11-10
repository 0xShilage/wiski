/** Client-safe shapes of the Phase 4 dashboard data (dates as ISO strings). */
import type { Picture } from '@/lib/media';

export type Kind = 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME';

export type AgendaEntry = {
  kind: 'ORDER' | 'CAMPAIGN' | 'SEGMENT';
  id: string;
  version: number;
  status: string;
  /** null only for a custom event */
  item: { id: string; kind: Kind; slug: string; title: string } | null;
  runtimeMinutes: number;
  sponsor: string | null;
  message: string | null;
  tier: 'topo' | 'prioridade' | null;
  since: string;
  sessionId: string | null;
  publicCode: string | null;
  /** 2026-11-04: a part of a series/franchise, or a custom event */
  segment: {
    kind: 'PART' | 'EVENT';
    label: string;
    note: string | null;
    campaignId: string | null;
    atStart: boolean;
    /** EVENT only (2026-11-09) */
    poster: Picture | null;
    posterId: string | null;
  } | null;
  parts?: {
    label: string;
    status: 'SCHEDULED' | 'PLAYING' | 'DONE';
    startsAt: string;
    season: number | null;
    episodeTo: number | null;
    film: number | null;
  }[];
  plan?: {
    seasonCount: number | null;
    episodeCount: number | null;
    runtimeMinutes: number;
    films: { position: number; title: string; runtimeMinutes: number }[];
  };
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
  playing: AgendaEntry | null;
};

export type AdminOrderView = {
  id: string;
  code: string;
  kind: 'MOVIE' | 'CONTRIBUTION';
  status: string;
  /** "Já pago": registered by the streamer, no Pix on the site */
  manual: boolean;
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
  subathon: 'Subathon (timer)',
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

/** "Já pago" (2026-11-02): titles that can be registered as paid outside the site. */
export type ManualCandidateView = {
  itemId: string;
  kind: Kind;
  title: string;
  slot: number | null;
  defaultCents: number;
  maxCents: number;
};
