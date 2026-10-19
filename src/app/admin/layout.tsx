import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'Painel', template: '%s · Painel · Wiski' },
  robots: { index: false, follow: false },
};

/** Dashboard shell: no public header/footer (its own sidebar). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <main id="conteudo" className="flex-1">
      {children}
    </main>
  );
}
