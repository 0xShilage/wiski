import Link from 'next/link';
import { formatBRL } from '@/lib/catalog/pricing';
import { ORDER_KIND_LABEL, statusOf } from '@/lib/orders/labels';

export type MyOrder = {
  publicCode: string;
  kind: 'MOVIE' | 'CONTRIBUTION';
  status: string;
  item: { title: string };
  totalCents: number;
  createdAt: string;
};

const date = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeZone: 'America/Sao_Paulo',
});

/** Perfil › Minhas compras (11 §2.4): sponsorships and contributions, newest first. */
export function MyOrders({ orders }: { orders: MyOrder[] }) {
  if (orders.length === 0) {
    return (
      <p className="text-fg/90">
        Seus patrocínios de filmes e contribuições para séries e franquias aparecem aqui. Compras
        feitas sem login podem ser vinculadas pela página do pedido.
      </p>
    );
  }
  return (
    <ul className="wf-myorders">
      {orders.map((o) => {
        const st = statusOf(o.status);
        return (
          <li key={o.publicCode}>
            <Link href={`/pedido/${o.publicCode}`} className="wf-myorders__row">
              <span className="min-w-0">
                <span className="wf-myorders__title">{o.item.title}</span>
                <span className="wf-muted text-sm">
                  {ORDER_KIND_LABEL[o.kind]} · {date.format(new Date(o.createdAt))} · {o.publicCode}
                </span>
              </span>
              <span className="wf-myorders__end">
                <b>{formatBRL(o.totalCents)}</b>
                <span className={`wf-tag wf-tag--${st.tone}`}>{st.label}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
