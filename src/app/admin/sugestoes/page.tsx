import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { SuggestionsBoard } from '@/components/admin/CommunityTools';
import { listSuggestions } from '@/server/suggestions/suggestions';

export const metadata: Metadata = { title: 'Sugestões' };

/** /admin/sugestoes — what viewers would like to watch (moderators and the streamer). */
export default async function SugestoesAdminPage() {
  const p = await adminPage('/admin/sugestoes');
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="sugestoes"
      title="Sugestões"
      lead="Títulos que o público gostaria de ver na live. Só a moderação e o streamer veem esta lista. Aceitar não coloca nada no catálogo: é um lembrete para a curadoria."
      {...p.shell}
    >
      <SuggestionsBoard initial={JSON.parse(JSON.stringify(await listSuggestions({})))} />
    </AdminShell>
  );
}
