import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { RoletaBoard } from '@/components/admin/RoletaBoard';
import { listRoletaPrizes } from '@/server/roleta/roleta';

export const metadata: Metadata = { title: 'Roleta' };

/** /admin/roleta — what viewers won on the wheel (moderators and the streamer). */
export default async function RoletaAdminPage() {
  const p = await adminPage('/admin/roleta');
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="roleta"
      title="Roleta"
      lead="Os prêmios que o público ganhou na roleta (quem tirou “Nada” não aparece). Cupons já chegam prontos para a pessoa; filmes e VIP na Twitch são entregues por vocês: entregue e marque aqui."
      {...p.shell}
    >
      <RoletaBoard initial={JSON.parse(JSON.stringify(await listRoletaPrizes({})))} />
    </AdminShell>
  );
}
