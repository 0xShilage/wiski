import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { BingoBoard } from '@/components/admin/BingoBoard';
import { staffBingo } from '@/server/bingo/bingo';

export const metadata: Metadata = { title: 'Bingo' };

/** /admin/bingo — mark what happened in the live; the server finds and announces the bingos. */
export default async function BingoAdminPage() {
  const p = await adminPage('/admin/bingo');
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="bingo"
      title="Bingo"
      lead="Marque cada item quando ele acontecer no chat ou na live. Quem completar uma linha aparece na live (alerta de Novo patrocínio) e no chat. Tudo recomeça às 16h."
      {...p.shell}
    >
      <BingoBoard initial={JSON.parse(JSON.stringify(await staffBingo()))} />
    </AdminShell>
  );
}
