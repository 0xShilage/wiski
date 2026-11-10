import type { Picture } from '@/lib/media';

/** Client-safe checkout types (shared by server props and the client forms). */
export type CheckoutProps = {
  open: boolean;
  /** pt-BR reason shown instead of the form when closed */
  closedCopy: string | null;
  /** Cloudflare Turnstile site key (public) */
  siteKey: string;
  legal: { terms: string; privacy: string; refund: string } | null;
  signedIn: { email: string } | null;
  perk: 'MODERATOR' | 'VIP' | null;
  tiers: { id: string; label: string; bps: number }[];
  contributionMinCents: number;
};

export type BreakdownLine = { key: string; label: string; cents: number | null };

export type OrderStatus =
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

/** Cinema ticket on a paid order (2026-11-10). `seat` = place in the Fila tab (1 = next). */
export type OrderTicket = {
  poster: Picture | null;
  /** the public name (@username or the guest name); null = anonymous */
  name: string | null;
  seat: number | null;
  watched: boolean;
};

export type OrderView = {
  order: {
    code: string;
    kind: 'MOVIE' | 'CONTRIBUTION';
    status: OrderStatus;
    item: { kind: 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME'; slug: string; title: string };
    breakdown: BreakdownLine[];
    totalCents: number;
    createdAt: string;
    expiresAt: string | null;
    paidAt: string | null;
    contactEmail: string;
    anonymous: boolean;
    displayName: string | null;
    displayNameStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
    message: string | null;
    messageStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
    pix: { qrCode: string; qrCodeBase64: string } | null;
    guest: boolean;
    session: { startsAt: string; status: 'PLANNED' | 'LIVE' | 'DONE' | 'CANCELLED' } | null;
    rescheduleLeft: number;
    /** the cinema ticket (2026-11-10): paid orders that still count, else null */
    ticket: OrderTicket | null;
  };
  canReschedule: boolean;
  canClaim: boolean;
  canCancel: boolean;
  orderCsrf: string | null;
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Aguardando pagamento',
  PAID: 'Pago',
  SCHEDULED: 'Agendado na live',
  WATCHING: 'Na live agora',
  COMPLETED: 'Concluído',
  EXPIRED: 'Pix expirado',
  CANCELLED: 'Cancelado',
  NEEDS_ATTENTION: 'Em análise',
  REFUND_PENDING: 'Reembolso em andamento',
  REFUNDED: 'Reembolsado',
};
