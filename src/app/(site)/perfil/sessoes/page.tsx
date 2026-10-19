import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SessionList } from '@/components/account/SessionList';
import { card } from '@/components/ui/styles';
import { formatDateTime } from '@/lib/format';
import { getCurrentSession } from '@/server/auth/current';
import { listActiveSessions } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Sessões ativas', robots: { index: false } };

export default async function SessoesPage() {
  const ctx = await getCurrentSession();
  if (!ctx) redirect('/perfil?returnTo=%2Fperfil%2Fsessoes');
  const sessions = await listActiveSessions(ctx.user.id);
  return (
    <div className="wf-page wf-page--narrow">
      <div className={`${card} space-y-6`}>
        <p>
          <Link href="/perfil" className="text-sm text-fg-muted underline-offset-4 hover:underline">
            ← Perfil
          </Link>
        </p>
        <h1 className="wf-h1">Sessões ativas</h1>
        <p className="text-fg/90">
          Estes são os dispositivos conectados à sua conta. Se não reconhecer algum, encerre a
          sessão.
        </p>
        <SessionList
          items={sessions.map((s) => ({
            id: s.id,
            device: s.uaFamily ?? 'Dispositivo desconhecido',
            lastSeen: formatDateTime(s.lastSeenAt),
            created: formatDateTime(s.createdAt),
            current: s.id === ctx.session.id,
          }))}
        />
      </div>
    </div>
  );
}
