import Link from 'next/link';

export type OpsSection =
  | 'agenda'
  | 'pedidos'
  | 'moderacao'
  | 'pessoas'
  | 'sugestoes'
  | 'roleta'
  | 'estreias'
  | 'overlays'
  | 'metas'
  | 'subathon'
  | 'media-kit'
  | 'links'
  | 'contato'
  | 'cupons'
  | 'auditoria'
  | 'configuracoes';

export type OpsCounts = {
  waiting: number;
  attention: number;
  texts: number;
  unread: number;
  suggestions: number;
  roleta: number;
};

const OPS: { id: OpsSection; label: string; badge?: (c: OpsCounts) => number }[] = [
  { id: 'agenda', label: 'Agenda da live' },
  { id: 'pedidos', label: 'Pedidos', badge: (c) => c.attention + c.texts },
  { id: 'moderacao', label: 'Moderação', badge: (c) => c.waiting },
  { id: 'pessoas', label: 'Pessoas' },
  { id: 'sugestoes', label: 'Sugestões', badge: (c) => c.suggestions },
  { id: 'roleta', label: 'Roleta', badge: (c) => c.roleta },
  { id: 'estreias', label: 'Estreias' },
];
const STREAMER: { id: OpsSection; label: string; badge?: (c: OpsCounts) => number }[] = [
  { id: 'overlays', label: 'Overlays (OBS)' },
  { id: 'metas', label: 'Metas' },
  { id: 'subathon', label: 'Subathon' },
  { id: 'media-kit', label: 'Media kit' },
  { id: 'links', label: 'Links' },
  { id: 'contato', label: 'Contato', badge: (c) => c.unread },
  { id: 'cupons', label: 'Cupons' },
  { id: 'auditoria', label: 'Auditoria' },
  { id: 'configuracoes', label: 'Configurações' },
];

/** The dashboard sidebar sections after "Catálogo" (Phase 4). Streamer-only ones are hidden from moderators. */
export function OpsNav({
  active,
  counts,
  role,
}: {
  active?: OpsSection | undefined;
  counts: OpsCounts;
  role: 'MODERATOR' | 'STREAMER' | 'USER';
}) {
  const item = (s: (typeof OPS)[number]) => {
    const n = s.badge?.(counts) ?? 0;
    return (
      <Link key={s.id} href={`/admin/${s.id}`} aria-current={active === s.id ? 'page' : undefined}>
        {s.label}
        {n ? (
          <small>
            {n}
            <span className="sr-only"> pendente{n === 1 ? '' : 's'}</span>
          </small>
        ) : null}
      </Link>
    );
  };
  return (
    <>
      <p className="wf-admin__group">Operação</p>
      <nav className="wf-admin__nav wf-admin__nav--ops" aria-label="Operação">
        {OPS.map(item)}
      </nav>
      {role === 'STREAMER' ? (
        <>
          <p className="wf-admin__group">Streamer</p>
          <nav className="wf-admin__nav wf-admin__nav--ops" aria-label="Streamer">
            {STREAMER.map(item)}
          </nav>
        </>
      ) : null}
    </>
  );
}
