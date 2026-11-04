import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { PeopleBoard } from '@/components/admin/PeopleBoard';
import { listUsers } from '@/server/users/admin';

export const metadata: Metadata = { title: 'Pessoas' };

/** /admin/pessoas — accounts, suspensions; roles and VIP for the streamer (MODERATOR+, passkey). */
export default async function PessoasPage() {
  const p = await adminPage('/admin/pessoas');
  if ('gate' in p) return p.gate;
  const role = p.ctx.user.role === 'STREAMER' ? 'STREAMER' : 'MODERATOR';
  const initial = await listUsers(role, {});
  return (
    <AdminShell
      active="pessoas"
      title="Pessoas"
      lead="Moderadores suspendem por até 7 dias. Suspensões mais longas, papéis e VIP são com o streamer (pedem login recente com o Google). “Liberar pedidos” zera os limites de checkout de quem travou (5 pedidos por hora, cupom errado) sem mexer em nenhum pedido."
      {...p.shell}
    >
      <PeopleBoard initial={initial} role={role} />
    </AdminShell>
  );
}
