'use client';

import './globals.css';
import Link from 'next/link';
import { Oops } from '@/components/brand/Oops';
import { fontVariables } from './fonts';

/** Last-resort boundary (replaces the root layout). 2026-11-10: the squirrel, lying down. */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR" className={fontVariables}>
      <body className="min-h-dvh bg-bg font-sans text-fg">
        <main className="wf-page">
          <Oops
            code="500"
            pose={3}
            title="O esquilo precisa de um minuto"
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
            Algo deu errado do nosso lado. Tente de novo em instantes.
          </Oops>
        </main>
      </body>
    </html>
  );
}
