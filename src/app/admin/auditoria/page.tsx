import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { AuditPanel } from '@/components/admin/StreamerTools';
import { auditPage } from '@/server/audit/viewer';

export const metadata: Metadata = { title: 'Auditoria' };

/** /admin/auditoria — streamer only (moderators: 404), passkey ≤ 10 min. */
export default async function AuditoriaPage() {
  const p = await adminPage('/admin/auditoria', { streamer: true });
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="auditoria"
      title="Auditoria"
      lead="Tudo o que a moderação e o streamer fizeram no painel, em ordem. Somente leitura."
      {...p.shell}
    >
      <AuditPanel initial={JSON.parse(JSON.stringify(await auditPage({})))} />
    </AdminShell>
  );
}
