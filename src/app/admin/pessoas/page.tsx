import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { PeopleBoard } from '@/components/admin/PeopleBoard';
import { listUsers } from '@/server/users/admin';
import { staffRole } from '@/lib/roles';

export const metadata: Metadata = { title: 'Pessoas' };

/** /admin/pessoas — accounts, suspensions; roles and VIP for the streamer (MODERATOR+, passkey). */
export default async function PessoasPage() {
  const p = await adminPage('/admin/pessoas');
  if ('gate' in p) return p.gate;
  const role = staffRole(p.ctx.user.role);
  const initial = await listUsers(role, {});
  return (
    <AdminShell
      active="pessoas"
      title="Pessoas"
      lead="Suspensões de mais de 7 dias, sem prazo e VIP pedem login recente com o Google. Quem é da moderação, o streamer e os Desenvolvedores decidem; quem é Desenvolvedor, só o streamer. “Liberar pedidos” zera os limites de checkout de quem travou (5 pedidos por hora, cupom errado) sem mexer em nenhum pedido."
      {...p.shell}
    >
      <PeopleBoard initial={initial} role={role} />
    </AdminShell>
  );
}
