'use client';

import { button, container, heading } from '@/components/ui/styles';

/** Error boundary (500). Never shows error details to the visitor. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="conteudo" className={`${container} grid flex-1 place-items-center py-16 text-center`}>
      <div className="space-y-6">
        <h1 className={heading.h1}>Algo deu errado</h1>
        <p className="text-fg/90">
          Tivemos um problema ao carregar esta página. Tente de novo em instantes.
        </p>
        <button type="button" className={button.primary} onClick={reset}>
          Tentar de novo
        </button>
      </div>
    </main>
  );
}
