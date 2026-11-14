import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { AgendaBoard } from '@/components/admin/AgendaBoard';
import type { AgendaEntry, AgendaSession } from '@/lib/admin/types';
import type { DayOff } from '@/lib/live/days-off';
import { daysOff } from '@/server/live/daysoff';
import { queue, sessionsWithEntries } from '@/server/live/schedule';
import { staffRole } from '@/lib/roles';

export const metadata: Metadata = { title: 'Agenda da live' };

/** /admin/agenda — sessions and the queue (MODERATOR+, passkey). */
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

export default async function AgendaPage() {
  const p = await adminPage('/admin/agenda');
  if ('gate' in p) return p.gate;
  const [sessions, waiting, offs] = await Promise.all([
    sessionsWithEntries({ from: daysAgo(3), take: 40 }),
    queue(),
    daysOff(),
  ]);
  // dates → ISO strings, the same shape the API answers
  const initial = JSON.parse(JSON.stringify({ sessions, queue: waiting, daysOff: offs })) as {
    sessions: AgendaSession[];
    queue: AgendaEntry[];
    daysOff: DayOff[];
  };
  return (
    <AdminShell
      active="agenda"
      title="Agenda da live"
      lead="Crie as sessões e coloque nelas os filmes pagos, alguns episódios de uma série ou um filme de uma franquia com meta atingida, e eventos seus (ex.: Jogando com os Viewers). Durante a live marque o que está passando e o que foi assistido — o fim de um filme, série ou franquia abre as avaliações."
      {...p.shell}
    >
      <AgendaBoard initial={initial} role={staffRole(p.ctx.user.role)} />
    </AdminShell>
  );
}
