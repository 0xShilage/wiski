import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { AlertSettingsPanel } from '@/components/admin/AlertSettingsPanel';
import { OverlayKeysPanel } from '@/components/admin/StreamerTools';
import { getEnv } from '@/server/env';
import { getAlertSettings, VOICES } from '@/server/overlay/alerts';
import { listOverlayKeys } from '@/server/overlay/keys';

export const metadata: Metadata = { title: 'Overlays (OBS)' };

/** /admin/overlays — moderators and the streamer (2026-11-08), passkey ≤ 10 min. */
export default async function OverlaysPage() {
  const p = await adminPage('/admin/overlays');
  if ('gate' in p) return p.gate;
  const [keys, alerts] = await Promise.all([listOverlayKeys(), getAlertSettings()]);
  return (
    <AdminShell
      active="overlays"
      title="Overlays (OBS)"
      lead="Chaves para as fontes de navegador do OBS. Cada chave abre só os widgets marcados e pode ser revogada a qualquer momento."
      {...p.shell}
    >
      <div className="grid gap-4">
        <OverlayKeysPanel initial={keys} origin={getEnv().APP_ORIGIN} />
        <AlertSettingsPanel initial={alerts} voices={VOICES} />
      </div>
    </AdminShell>
  );
}
