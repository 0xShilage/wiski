import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { OverlayKeysPanel } from '@/components/admin/StreamerTools';
import { getEnv } from '@/server/env';
import { listOverlayKeys } from '@/server/overlay/keys';

export const metadata: Metadata = { title: 'Overlays (OBS)' };

/** /admin/overlays — streamer only (moderators: 404), passkey ≤ 10 min. */
export default async function OverlaysPage() {
  const p = await adminPage('/admin/overlays', { streamer: true });
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="overlays"
      title="Overlays (OBS)"
      lead="Chaves para as fontes de navegador do OBS. Cada chave abre só os widgets marcados e pode ser revogada a qualquer momento."
      {...p.shell}
    >
      <OverlayKeysPanel initial={await listOverlayKeys()} origin={getEnv().APP_ORIGIN} />
    </AdminShell>
  );
}
