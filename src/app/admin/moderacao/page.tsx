import type { Metadata } from 'next';
import Link from 'next/link';
import { adminGate } from '@/components/admin/AdminGate';
import { ModerationQueue } from '@/components/admin/ModerationQueue';
import { OpsNav } from '@/components/admin/OpsNav';
import { Logo } from '@/components/brand/Logo';
import { adminCounts } from '@/server/catalog/read';
import { moderationQueue } from '@/server/reviews/moderation';

export const metadata: Metadata = { title: 'Moderação' };

const ROLE_LABEL = { MODERATOR: 'Moderação', STREAMER: 'Streamer', USER: '' } as const;
const CATALOG = [
  ['filmes', 'Filmes', 'MOVIE', 35],
  ['series', 'Séries', 'SERIES', 10],
  ['franquias', 'Franquias', 'FRANCHISE', 10],
] as const;

/** /admin/moderacao — review moderation queue (MODERATOR+, passkey ≤ 10 min). */
export default async function ModeracaoPage() {
  const g = await adminGate('/admin/moderacao');
  if ('gate' in g) return g.gate;
  const { ctx } = g;
  const [queue, counts] = await Promise.all([moderationQueue(), adminCounts()]);
  const role = ctx.user.role === 'STREAMER' ? 'STREAMER' : 'MODERATOR';

  return (
    <div className="wf-admin wf-admin--two">
      <aside className="wf-admin__side" aria-label="Painel">
        <Link href="/" className="wf-logo" aria-label="Wiski — ver o site">
          <Logo />
        </Link>
        <p className="wf-admin__group">Catálogo</p>
        <nav className="wf-admin__nav" aria-label="Catálogo">
          {CATALOG.map(([tipo, label, kind, limit]) => (
            <Link key={tipo} href={`/admin/catalogo?tipo=${tipo}`}>
              {label}
              <small>
                {counts[kind]}/{limit}
              </small>
            </Link>
          ))}
        </nav>
        <OpsNav active="moderacao" waiting={queue.total} />
        <div className="wf-admin__me">
          <p className="m-0 font-semibold">
            @{ctx.user.username ?? 'moderacao'} · {ROLE_LABEL[ctx.user.role]}
          </p>
          <p className="wf-admin__ok m-0 mt-1">● Passkey verificada</p>
          <Link href="/perfil" className="wf-linkbtn text-xs">
            Perfil
          </Link>
        </div>
      </aside>
      <section className="wf-mod" aria-labelledby="mod-title">
        <div>
          <h1 className="wf-h1" id="mod-title">
            Moderação
          </h1>
          <p className="wf-muted mt-2 max-w-2xl">
            Avaliações escondidas automaticamente (mais de 2 links, ou 3 denúncias de contas com 7+
            dias) e avaliações com denúncias abertas. Ocultar e restaurar ficam no histórico de
            auditoria; remover de vez é só para o streamer.
          </p>
        </div>
        <ModerationQueue initial={queue} role={role} />
      </section>
    </div>
  );
}
