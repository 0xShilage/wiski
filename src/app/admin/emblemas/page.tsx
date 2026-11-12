import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { BadgesAdmin } from '@/components/admin/BadgesAdmin';
import { adminBadges } from '@/server/badges/badges';

export const metadata: Metadata = { title: 'Emblemas' };

/** /admin/emblemas — time-limited badges for events (moderators and the streamer). */
export default async function BadgesAdminPage() {
  const p = await adminPage('/admin/emblemas');
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="emblemas"
      title="Emblemas"
      lead="Emblemas de edição limitada para eventos da live (maratonas, sessões especiais). Quem estiver lá resgata em /emblemas enquanto o período está aberto — com a palavra dita na live, se você definir uma."
      {...p.shell}
    >
      <BadgesAdmin badges={await adminBadges()} />
    </AdminShell>
  );
}
