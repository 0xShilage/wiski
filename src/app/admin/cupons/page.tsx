import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { VouchersPanel } from '@/components/admin/StreamerTools';
import { listVouchers } from '@/server/admin/vouchers';

export const metadata: Metadata = { title: 'Cupons' };

/** /admin/cupons — moderators and the streamer (2026-11-08), passkey ≤ 10 min. */
export default async function CuponsPage() {
  const p = await adminPage('/admin/cupons');
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="cupons"
      title="Cupons"
      lead="Cupons valem só para patrocínio de filmes. Criar e mudar pede login recente com o Google."
      {...p.shell}
    >
      <VouchersPanel initial={await listVouchers()} />
    </AdminShell>
  );
}
