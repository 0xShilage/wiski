'use client';

import Link from 'next/link';
import { Oops } from '@/components/brand/Oops';

/** Error boundary (500). Never shows error details to the visitor. 2026-11-10: the squirrel. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="conteudo" className="wf-page flex-1">
      <Oops
        code="500"
        pose={2}
        title="O esquilo tropeçou no cabo da live"
        actions={
          <>
            <button type="button" className="wf-btn wf-btn--neon" onClick={reset}>
              Tentar de novo
            </button>
            <Link href="/" className="wf-btn wf-btn--ghost">
              Voltar para o início
            </Link>
          </>
        }
      >
        Tivemos um problema ao carregar esta página. Tente de novo em instantes — se continuar,
        avise a gente pela página de Contato.
      </Oops>
    </main>
  );
}
