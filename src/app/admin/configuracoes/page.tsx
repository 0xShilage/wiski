import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { SettingsPanel } from '@/components/admin/StreamerTools';
import { getSettings } from '@/server/admin/settings';

export const metadata: Metadata = { title: 'Configurações' };

/** /admin/configuracoes — streamer only (moderators: 404), passkey ≤ 10 min. */
export default async function ConfiguracoesPage() {
  const p = await adminPage('/admin/configuracoes', { streamer: true });
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="configuracoes"
      title="Configurações"
      lead="Interruptores gerais do site."
      {...p.shell}
    >
      <SettingsPanel initial={await getSettings()} />
    </AdminShell>
  );
}
