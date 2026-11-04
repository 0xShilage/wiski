import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { SubathonPanel } from '@/components/admin/SubathonPanel';
import { subathonAdminView } from '@/server/subathon/admin';

export const metadata: Metadata = { title: 'Subathon' };

/** /admin/subathon — the subathon timer (streamer only; moderators: 404). */
export default async function SubathonAdminPage() {
  const p = await adminPage('/admin/subathon', { streamer: true });
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="subathon"
      title="Subathon"
      lead="Um timer que cresce com cada contribuição: pagamentos do site e doações, bits e subs da live (StreamElements). No OBS, use o widget “Subathon (timer)” de Admin › Overlays."
      {...p.shell}
    >
      <SubathonPanel initial={await subathonAdminView()} />
    </AdminShell>
  );
}
