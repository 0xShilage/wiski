import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { InboxPanel } from '@/components/admin/StreamerTools';
import { listContact } from '@/server/contact/contact';

export const metadata: Metadata = { title: 'Contato' };

/** /admin/contato — moderators and the streamer (2026-11-08), passkey ≤ 10 min. */
export default async function ContatoPage() {
  const p = await adminPage('/admin/contato');
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="contato"
      title="Contato"
      lead="Mensagens do formulário de contato. Elas se apagam sozinhas depois de 12 meses (LGPD)."
      {...p.shell}
    >
      <InboxPanel initial={JSON.parse(JSON.stringify(await listContact({})))} />
    </AdminShell>
  );
}
