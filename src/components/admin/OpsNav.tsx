import Link from 'next/link';

/** "Operação" in the dashboard sidebar: Moderação is live (Phase 3); the rest comes in Phase 4. */
export function OpsNav({ active, waiting }: { active?: 'moderacao'; waiting: number }) {
  return (
    <>
      <p className="wf-admin__group">Operação</p>
      <nav className="wf-admin__nav wf-admin__nav--ops" aria-label="Operação">
        <Link href="/admin/moderacao" aria-current={active === 'moderacao' ? 'page' : undefined}>
          Moderação
          {waiting ? (
            <small>
              {waiting}
              <span className="sr-only"> aguardando</span>
            </small>
          ) : null}
        </Link>
        {['Campanhas', 'Sessões da live', 'Auditoria'].map((l) => (
          <span key={l} aria-disabled="true" title="Em breve">
            {l}
          </span>
        ))}
      </nav>
    </>
  );
}
