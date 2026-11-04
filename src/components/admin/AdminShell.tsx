import { LIVE_LIMIT } from '@/lib/catalog/pricing';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import type { Role } from '@/generated/prisma/enums';
import { OpsNav, type OpsCounts, type OpsSection } from './OpsNav';

const ROLE_LABEL = { MODERATOR: 'Moderação', STREAMER: 'Streamer', USER: '' } as const;
const CATALOG = [
  ['filmes', 'Filmes', 'MOVIE', LIVE_LIMIT.MOVIE],
  ['series', 'Séries', 'SERIES', LIVE_LIMIT.SERIES],
  ['franquias', 'Franquias', 'FRANCHISE', LIVE_LIMIT.FRANCHISE],
] as const;

/** Dashboard pages other than the catalogue board: sidebar + one content column. */
export function AdminShell({
  active,
  title,
  lead,
  user,
  catalog,
  counts,
  children,
}: {
  active: OpsSection;
  title: string;
  lead?: string;
  user: { username: string | null; role: Role };
  catalog: Record<'MOVIE' | 'SERIES' | 'FRANCHISE', number>;
  counts: OpsCounts;
  children: ReactNode;
}) {
  return (
    <div className="wf-admin wf-admin--two">
      <aside className="wf-admin__side" aria-label="Painel">
        <Link href="/" className="wf-logo" aria-label="Wiski — ver o site">
          <Logo />
        </Link>
        <p className="wf-admin__group">Catálogo</p>
        <nav className="wf-admin__nav" aria-label="Catálogo">
          {CATALOG.map(([tipo, label, kind, limit]) => (
            <Link key={tipo} href={`/admin/catalogo?tipo=${tipo}`} prefetch={false}>
              {label}
              <small>
                {catalog[kind]}/{limit}
              </small>
            </Link>
          ))}
        </nav>
        <OpsNav active={active} counts={counts} role={user.role} />
        <div className="wf-admin__me">
          <p className="m-0 font-semibold">
            @{user.username ?? 'moderacao'} · {ROLE_LABEL[user.role]}
          </p>
          <p className="wf-admin__ok m-0 mt-1">● Verificação em duas etapas ok</p>
          <Link href="/perfil" className="wf-linkbtn text-xs">
            Perfil
          </Link>
        </div>
      </aside>
      <section className="wf-mod" aria-labelledby="adm-title">
        <div>
          <h1 className="wf-h1" id="adm-title">
            {title}
          </h1>
          {lead ? <p className="wf-muted mt-2 max-w-3xl">{lead}</p> : null}
        </div>
        {children}
      </section>
    </div>
  );
}
