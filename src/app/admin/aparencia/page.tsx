import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { PopupPanel, SeasonPanel } from '@/components/admin/AppearancePanels';
import { getSeasonSetting, popupForAdmin } from '@/server/site/appearance';

export const metadata: Metadata = { title: 'Aparência' };

/** /admin/aparencia (2026-11-10) — seasonal theme and the home pop-up; moderators and the streamer. */
export default async function AparenciaPage() {
  const p = await adminPage('/admin/aparencia');
  if ('gate' in p) return p.gate;
  const [season, popup] = await Promise.all([getSeasonSetting(), popupForAdmin()]);
  return (
    <AdminShell
      active="aparencia"
      title="Aparência"
      lead="Tema de datas especiais para o site inteiro e o pop-up da página inicial."
      {...p.shell}
    >
      <div className="grid gap-4">
        <SeasonPanel initial={season} />
        <PopupPanel initial={popup} />
      </div>
    </AdminShell>
  );
}
