import type { Metadata } from 'next';
import Link from 'next/link';
import { adminPageGate } from '@/components/admin/AdminGate';
import { OrdersAdmin } from '@/components/admin/OrdersAdmin';
import { KIND_UI } from '@/components/admin/types';
import {
  ADMIN_FILTERS,
  type AdminFilter,
  adminCountsByFilter,
  getAdminOrder,
  listAdminOrders,
} from '@/server/orders/admin';

export const metadata: Metadata = { title: 'Pedidos' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const CODE = /^WF-[0-9A-HJKMNP-TV-Z]{6}$/;

/**
 * /admin/pedidos (13 §3 step 13) — MODERATOR / STREAMER with a fresh passkey. Moderators review
 * the public names/messages; the STREAMER also resolves NEEDS_ATTENTION and refunds (step-up).
 */
export default async function PedidosPage({ searchParams }: Props) {
  const g = await adminPageGate('/admin/pedidos');
  if (!g.ok) return g.gate;
  const { user } = g.ctx;

  const params = await searchParams;
  const counts = await adminCountsByFilter();
  const requested = typeof params.filtro === 'string' ? params.filtro : null;
  const filter: AdminFilter =
    requested && requested in ADMIN_FILTERS
      ? (requested as AdminFilter)
      : counts.atencao > 0
        ? 'atencao'
        : counts.moderacao > 0
          ? 'moderacao'
          : 'todos';
  const code = typeof params.pedido === 'string' && CODE.test(params.pedido) ? params.pedido : null;
  const actor = { id: user.id, role: user.role };
  const [list, detail] = await Promise.all([
    listAdminOrders({ filter }),
    code ? getAdminOrder(code, actor).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <OrdersAdmin
      user={{ username: user.username ?? 'moderacao', role: user.role }}
      initialFilter={filter}
      initialCounts={counts}
      initialList={list}
      initialDetail={detail}
      catalogNav={
        <nav className="wf-admin__nav" aria-label="Catálogo">
          {(['MOVIE', 'SERIES', 'FRANCHISE'] as const).map((k) => (
            <Link key={k} href={`/admin/catalogo?tipo=${KIND_UI[k].tipo}`}>
              {KIND_UI[k].many}
            </Link>
          ))}
        </nav>
      }
    />
  );
}
