import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { StatsPanel } from '@/components/admin/StreamerTools';
import { listStats, METRIC_LABEL } from '@/server/mediakit/stats';

export const metadata: Metadata = { title: 'Media kit' };

/** /admin/media-kit — streamer only (moderators: 404), passkey ≤ 10 min. */
export default async function MediaKitPage() {
  const p = await adminPage('/admin/media-kit', { streamer: true });
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="media-kit"
      title="Media kit"
      lead="Os números que marcas veem em /media-kit. Por enquanto você digita; a leitura automática de Twitch e YouTube precisa das credenciais dessas plataformas."
      {...p.shell}
    >
      <StatsPanel initial={await listStats()} metrics={METRIC_LABEL} />
    </AdminShell>
  );
}
