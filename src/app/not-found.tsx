import Link from 'next/link';
import { Mascote } from '@/components/brand/Mascote';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { button, container, heading } from '@/components/ui/styles';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main
        id="conteudo"
        className={`${container} grid flex-1 place-items-center py-16 text-center`}
      >
        <div className="space-y-6">
          <div className="mx-auto w-40">
            <Mascote pose={3} colour="violet" />
          </div>
          <h1 className={heading.h1}>Página não encontrada</h1>
          <p className="text-fg/90">O endereço pode estar errado ou a página saiu do ar.</p>
          <Link href="/" className={button.primary}>
            Voltar para o início
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
