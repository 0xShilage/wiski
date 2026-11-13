import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { OrdersBoard } from '@/components/admin/OrdersBoard';
import type { AdminOrderView } from '@/lib/admin/types';
import { listOrders, orderCounts } from '@/server/checkout/admin';
import { staffRole } from '@/lib/roles';

export const metadata: Metadata = { title: 'Pedidos' };

/** /admin/pedidos — orders, hiding a name or message, streamer exceptions (MODERATOR+, passkey). */
export default async function PedidosPage() {
  const p = await adminPage('/admin/pedidos');
  if ('gate' in p) return p.gate;
  const role = staffRole(p.ctx.user.role);
  const counts = await orderCounts();
  const list = await listOrders(role, counts.attention ? { status: 'NEEDS_ATTENTION' } : {});
  return (
    <AdminShell
      active="pedidos"
      title="Pedidos"
      lead="Nomes e mensagens aparecem na hora, sem aprovação — aqui você oculta o que não quiser na live e pode mostrar de novo. Pedidos que precisam de atenção (Pix pago depois do prazo, valor que não conferiu) podem ser aceitos como venda aqui; reembolsar é só com o streamer."
      {...p.shell}
    >
      <OrdersBoard
        initial={{ orders: list.orders as AdminOrderView[], next: list.next, counts }}
        role={role}
      />
    </AdminShell>
  );
}
