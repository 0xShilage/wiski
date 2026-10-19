'use client';

import './globals.css';

/** Last-resort boundary (replaces the root layout). */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body className="grid min-h-dvh place-items-center bg-bg p-6 text-center font-sans text-fg">
        <main className="space-y-4">
          <h1 className="text-2xl font-semibold">Algo deu errado</h1>
          <p>Tente de novo em instantes.</p>
          <button
            type="button"
            className="rounded-pill bg-accent px-5 py-2.5 font-semibold text-accent-fg"
            onClick={reset}
          >
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  );
}
