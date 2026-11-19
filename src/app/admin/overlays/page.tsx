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
        <section className="wf-ops-card" aria-labelledby="moldura-camera">
          <h2 id="moldura-camera">Moldura da câmera (16:9)</h2>
          <p className="wf-muted text-sm">
            Pôr do sol, coqueiros e estrelinhas em volta da câmera, com animação. Não precisa de
            chave: no OBS, adicione uma “Fonte de navegador” com este endereço, em 16:9 e do mesmo
            tamanho da câmera (ex.: 1280 × 720), e coloque-a acima da câmera. O meio é transparente.
          </p>
          <code className="wf-code">{`${getEnv().APP_ORIGIN}/overlay/camera?nome=Iara&sub=wiski.fun`}</code>
          <p className="wf-muted text-sm">
            <code>nome</code> (e <code>sub</code>, a linha de baixo) mostram a plaquinha no canto;
            sem <code>nome</code>, fica só a moldura. <code>ao-vivo=0</code> tira a etiqueta “AO
            VIVO”.
          </p>
        </section>
      </div>
    </AdminShell>
  );
}
