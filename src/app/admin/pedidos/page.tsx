import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { OrdersBoard } from '@/components/admin/OrdersBoard';
import type { AdminOrderView } from '@/lib/admin/types';
import { listOrders, orderCounts } from '@/server/checkout/admin';

export const metadata: Metadata = { title: 'Pedidos' };

/** /admin/pedidos — orders, text approvals, streamer exceptions (MODERATOR+, passkey). */
export default async function PedidosPage() {
  const p = await adminPage('/admin/pedidos');
  if ('gate' in p) return p.gate;
  const role = p.ctx.user.role === 'STREAMER' ? 'STREAMER' : 'MODERATOR';
  const counts = await orderCounts();
  const list = await listOrders(role, counts.attention ? { status: 'NEEDS_ATTENTION' } : {});
  return (
    <AdminShell
      active="pedidos"
      title="Pedidos"
      lead="Aprove os nomes e mensagens que aparecem na live. Pedidos que precisam de atenção (Pix pago depois do prazo, valor que não conferiu) ficam com o streamer: aceitar como venda ou reembolsar."
      {...p.shell}
    >
      <OrdersBoard
        initial={{ orders: list.orders as AdminOrderView[], next: list.next, counts }}
        role={role}
      />
    </AdminShell>
  );
}
