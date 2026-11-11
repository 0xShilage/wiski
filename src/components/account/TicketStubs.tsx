import Link from 'next/link';
import { MediaPicture } from '@/components/media/MediaPicture';
import type { OrderStatus } from '@/generated/prisma/enums';
import { formatBRL } from '@/lib/catalog/pricing';
import { ORDER_STATUS_LABEL } from '@/lib/checkout/types';
import type { Picture } from '@/lib/media';

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

export type StubOrder = {
  code: string;
  kind: 'MOVIE' | 'CONTRIBUTION';
  status: OrderStatus;
  item: { title: string };
  poster: Picture | null;
  totalCents: number;
  createdAt: string;
};

/** valid = paid and not refunded; pending = still being paid or checked; void = no longer valid */
export function stubState(status: OrderStatus): 'valid' | 'used' | 'pending' | 'void' {
  if (status === 'COMPLETED') return 'used';
  if (status === 'PAID' || status === 'SCHEDULED' || status === 'WATCHING') return 'valid';
  if (status === 'PENDING_PAYMENT' || status === 'NEEDS_ATTENTION') return 'pending';
  return 'void';
}

const STAMP: Partial<Record<OrderStatus, string>> = {
  COMPLETED: 'Assistido',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
  REFUND_PENDING: 'Reembolsando',
  REFUNDED: 'Reembolsado',
};

/**
 * Perfil › "Meus patrocínios e contribuições" as cinema tickets (2026-11-11): the main part with
 * the poster and the title, and a stub torn along a perforated line with "Admite 1", the amount
 * and the order code. A valid ticket's stub tears off a little on hover; an expired, cancelled or
 * refunded one is greyed out with a stamp; a watched one is stamped "Assistido". Each ticket opens
 * the order page, where the full ticket is.
 */
export function TicketStubs({ orders }: { orders: StubOrder[] }) {
  return (
    <ul className="wf-stubs">
      {orders.map((o) => {
        const state = stubState(o.status);
        const stamp = STAMP[o.status];
        return (
          <li key={o.code}>
            <Link
              href={`/pedido/${o.code}`}
              className={`wf-stub wf-stub--${state}`}
              aria-label={`${o.item.title}: ${o.kind === 'MOVIE' ? 'patrocínio' : 'contribuição'} de ${formatBRL(o.totalCents)}, ${ORDER_STATUS_LABEL[o.status].toLowerCase()} (pedido ${o.code})`}
            >
              <span className="wf-stub__main" aria-hidden="true">
                <span className="wf-stub__poster">
                  {o.poster ? <MediaPicture picture={o.poster} alt="" sizes="48px" /> : null}
                </span>
                <span className="wf-stub__body">
                  <span className="wf-stub__kicker">
                    {o.kind === 'MOVIE' ? 'Patrocínio' : 'Contribuição'} ·{' '}
                    {dateFmt.format(new Date(o.createdAt))}
                  </span>
                  <span className="wf-stub__title">{o.item.title}</span>
                  <span className="wf-stub__status">{ORDER_STATUS_LABEL[o.status]}</span>
                </span>
              </span>
              <span className="wf-stub__tear" aria-hidden="true">
                <span className="wf-stub__admit">
                  {state === 'pending' ? 'Aguardando' : 'Admite 1'}
                </span>
                <b className="wf-stub__value">{formatBRL(o.totalCents)}</b>
                <span className="wf-stub__code">{o.code}</span>
                {stamp ? <span className="wf-stub__stamp">{stamp}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
