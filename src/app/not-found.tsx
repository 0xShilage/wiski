import Link from 'next/link';
import { Oops } from '@/components/brand/Oops';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';

/** 404 (2026-11-10: the squirrel version). */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="conteudo" className="wf-page flex-1">
        <Oops
          code="404"
          pose={4}
          title="Esse título saiu da fila…"
          actions={
            <>
              <Link href="/" className="wf-btn wf-btn--neon">
                Ver os filmes
              </Link>
              <Link href="/fila" className="wf-btn wf-btn--ghost">
                Ver a Fila
              </Link>
            </>
          }
        >
          O endereço pode estar errado, ou esta página foi embora antes da sessão começar. O esquilo
          procurou por toda parte e não achou.
        </Oops>
      </main>
      <SiteFooter />
    </>
  );
}
