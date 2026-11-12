import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { GuidePortraitsPanel } from '@/components/admin/GuidePortraitsPanel';
import { allSlots, GUIDE_ID } from '@/lib/guides/dark-s1';
import { guidePortraits } from '@/server/guides/portraits';

export const metadata: Metadata = { title: 'Guia de Winden' };

/** /admin/guias — the photos of the Dark guide's characters (moderators and the streamer). */
export default async function GuidesAdminPage() {
  const p = await adminPage('/admin/guias');
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="guias"
      title="Guia de Winden"
      lead="As fotos dos personagens do guia de Dark (/guias/dark). Cada foto só aparece no guia junto com a pessoa, no episódio em que ela aparece."
      {...p.shell}
    >
      <GuidePortraitsPanel
        guide={GUIDE_ID}
        slots={allSlots()}
        initial={await guidePortraits(GUIDE_ID)}
      />
    </AdminShell>
  );
}
