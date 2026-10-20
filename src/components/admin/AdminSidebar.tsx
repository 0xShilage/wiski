import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';

const ROLE_LABEL = { MODERATOR: 'Moderação', STREAMER: 'Streamer', USER: '' } as const;

/**
 * The dashboard sidebar shared by /admin/catalogo and /admin/pedidos: the catalog nav (passed in
 * by the page — the catalog switches kinds client-side), Operação, and who is signed in.
 */
export function AdminSidebar({
  current,
  catalogNav,
  attention,
  user,
}: {
  current: 'catalogo' | 'pedidos';
  catalogNav: ReactNode;
  /** orders waiting for a decision or moderation (badge on "Pedidos") */
  attention: number | null;
  user: { username: string; role: 'MODERATOR' | 'STREAMER' | 'USER' };
}) {
  return (
    <aside className="wf-admin__side" aria-label="Painel">
      <Link href="/" className="wf-logo" aria-label="Wiski — ver o site">
        <Logo />
      </Link>
      <p className="wf-admin__group">Catálogo</p>
      {catalogNav}
      <p className="wf-admin__group">Operação</p>
      <nav className="wf-admin__nav wf-admin__nav--ops" aria-label="Operação">
        <Link href="/admin/pedidos" aria-current={current === 'pedidos' ? 'page' : undefined}>
          Pedidos
          {attention ? (
            <small className="wf-admin__badge" aria-label={`${attention} aguardando`}>
              {attention}
            </small>
          ) : null}
        </Link>
        {['Sessões da live', 'Preços e cupons', 'Auditoria'].map((l) => (
          <span key={l} aria-disabled="true" title="Em breve">
            {l}
          </span>
        ))}
      </nav>
      <div className="wf-admin__me">
        <p className="m-0 font-semibold">
          @{user.username} · {ROLE_LABEL[user.role]}
        </p>
        <p className="wf-admin__ok m-0 mt-1">● Passkey verificada</p>
        <Link href="/perfil" className="wf-linkbtn text-xs">
          Perfil
        </Link>
      </div>
    </aside>
  );
}
