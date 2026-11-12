import Link from 'next/link';

export type OpsSection =
  | 'agenda'
  | 'chat'
  | 'pedidos'
  | 'moderacao'
  | 'pessoas'
  | 'sugestoes'
  | 'roleta'
  | 'estreias'
  | 'jogos'
  | 'analise'
  | 'overlays'
  | 'aparencia'
  | 'metas'
  | 'subathon'
  | 'media-kit'
  | 'links'
  | 'guias'
  | 'emblemas'
  | 'contato'
  | 'cupons'
  | 'auditoria'
  | 'configuracoes';

export type OpsCounts = {
  waiting: number;
  attention: number;
  unread: number;
  suggestions: number;
  roleta: number;
};

const OPS: { id: OpsSection; label: string; badge?: (c: OpsCounts) => number }[] = [
  { id: 'agenda', label: 'Agenda da live' },
  { id: 'chat', label: 'Chat da live' },
  { id: 'pedidos', label: 'Pedidos', badge: (c) => c.attention },
  { id: 'moderacao', label: 'Moderação', badge: (c) => c.waiting },
  { id: 'pessoas', label: 'Pessoas' },
  { id: 'sugestoes', label: 'Sugestões', badge: (c) => c.suggestions },
  { id: 'roleta', label: 'Roleta', badge: (c) => c.roleta },
  { id: 'estreias', label: 'Estreias' },
  { id: 'jogos', label: 'Jogos' },
];
const CHANNEL: { id: OpsSection; label: string; badge?: (c: OpsCounts) => number }[] = [
  { id: 'analise', label: 'Análise' },
  { id: 'overlays', label: 'Overlays (OBS)' },
  { id: 'aparencia', label: 'Aparência' },
  { id: 'metas', label: 'Metas' },
  { id: 'subathon', label: 'Subathon' },
  { id: 'media-kit', label: 'Media kit' },
  { id: 'links', label: 'Links' },
  { id: 'guias', label: 'Guia de Winden' },
  { id: 'emblemas', label: 'Emblemas' },
  { id: 'contato', label: 'Contato', badge: (c) => c.unread },
  { id: 'cupons', label: 'Cupons' },
  { id: 'auditoria', label: 'Auditoria' },
  { id: 'configuracoes', label: 'Configurações' },
];

/** The dashboard sidebar sections after "Catálogo" (Phase 4); moderators see all of them since 2026-11-08. */
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
      <Link
        key={s.id}
        href={`/admin/${s.id}`}
        prefetch={false}
        aria-current={active === s.id ? 'page' : undefined}
      >
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
      {role === 'USER' ? null : (
        <>
          <p className="wf-admin__group">Canal</p>
          <nav className="wf-admin__nav wf-admin__nav--ops" aria-label="Canal">
            {CHANNEL.map(item)}
          </nav>
        </>
      )}
    </>
  );
}
