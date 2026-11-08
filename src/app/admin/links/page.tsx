import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { LinksPanel } from '@/components/admin/CommunityTools';
import { listLinks } from '@/server/links/links';

export const metadata: Metadata = { title: 'Links' };

/** /admin/links — the Links page's buttons (moderators and the streamer). */
export default async function LinksAdminPage() {
  const p = await adminPage('/admin/links');
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="links"
      title="Links"
      lead="Os botões da página Links, na ordem em que aparecem. Só endereços https://; até 30 links."
      {...p.shell}
    >
      <LinksPanel initial={await listLinks()} />
    </AdminShell>
  );
}
