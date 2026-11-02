import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { AgendaBoard } from '@/components/admin/AgendaBoard';
import type { AgendaEntry, AgendaSession } from '@/lib/admin/types';
import { queue, sessionsWithEntries } from '@/server/live/schedule';

export const metadata: Metadata = { title: 'Agenda da live' };

/** /admin/agenda — sessions and the queue (MODERATOR+, passkey). */
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

export default async function AgendaPage() {
  const p = await adminPage('/admin/agenda');
  if ('gate' in p) return p.gate;
  const [sessions, waiting] = await Promise.all([
    sessionsWithEntries({ from: daysAgo(3), take: 40 }),
    queue(),
  ]);
  // dates → ISO strings, the same shape the API answers
  const initial = JSON.parse(JSON.stringify({ sessions, queue: waiting })) as {
    sessions: AgendaSession[];
    queue: AgendaEntry[];
  };
  return (
    <AdminShell
      active="agenda"
      title="Agenda da live"
      lead="Crie as sessões, coloque nelas os filmes pagos e as campanhas com meta atingida, e durante a live marque o que está passando e o que foi assistido — isso abre as avaliações."
      {...p.shell}
    >
      <AgendaBoard
        initial={initial}
        role={p.ctx.user.role === 'STREAMER' ? 'STREAMER' : 'MODERATOR'}
      />
    </AdminShell>
  );
}
