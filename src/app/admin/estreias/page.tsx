import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { ReleasesPanel } from '@/components/admin/CommunityTools';
import { linkableSeries, listReleases } from '@/server/releases/releases';

export const metadata: Metadata = { title: 'Estreias' };

/** /admin/estreias — "Próximas temporadas" on the Cronograma (moderators and the streamer). */
export default async function EstreiasPage() {
  const p = await adminPage('/admin/estreias');
  if ('gate' in p) return p.gate;
  const [releases, series] = await Promise.all([listReleases(), linkableSeries()]);
  return (
    <AdminShell
      active="estreias"
      title="Estreias"
      lead="Quando sai a próxima temporada de uma série. Aparece no Cronograma em “Próximas temporadas” e continua lá por 7 dias depois da estreia. Escolha uma série do catálogo para mostrar o pôster e o link, ou digite o nome de qualquer outra."
      {...p.shell}
    >
      <ReleasesPanel initial={{ releases, series }} />
    </AdminShell>
  );
}
