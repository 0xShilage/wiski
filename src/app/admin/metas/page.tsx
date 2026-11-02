import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { GoalsPanel } from '@/components/admin/StreamerTools';
import { listGoals } from '@/server/goals/goals';

export const metadata: Metadata = { title: 'Metas' };

/** /admin/metas — streamer only (moderators: 404), passkey ≤ 10 min. */
export default async function MetasPage() {
  const p = await adminPage('/admin/metas', { streamer: true });
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="metas"
      title="Metas"
      lead="Metas aparecem no overlay e, se você quiser, no media kit. Arrecadação aparece em público só como porcentagem."
      {...p.shell}
    >
      <GoalsPanel initial={await listGoals()} />
    </AdminShell>
  );
}
