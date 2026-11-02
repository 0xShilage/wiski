import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { ModerationQueue } from '@/components/admin/ModerationQueue';
import { moderationQueue } from '@/server/reviews/moderation';

export const metadata: Metadata = { title: 'Moderação' };

/** /admin/moderacao — review moderation queue (MODERATOR+, passkey ≤ 10 min). */
export default async function ModeracaoPage() {
  const p = await adminPage('/admin/moderacao');
  if ('gate' in p) return p.gate;
  const queue = await moderationQueue();
  return (
    <AdminShell
      active="moderacao"
      title="Moderação"
      lead="Avaliações escondidas automaticamente (mais de 2 links, ou 3 denúncias de contas com 7+ dias) e avaliações com denúncias abertas. Ocultar e restaurar ficam no histórico de auditoria; remover de vez é só para o streamer."
      {...p.shell}
    >
      <ModerationQueue
        initial={queue}
        role={p.ctx.user.role === 'STREAMER' ? 'STREAMER' : 'MODERATOR'}
      />
    </AdminShell>
  );
}
