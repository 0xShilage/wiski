import type { ReactNode } from 'react';
import { card } from '@/components/ui/styles';

/** Legal / informational pages until the final texts exist (Q13). Provisional ones say so. */
export function LegalPlaceholder({
  title,
  children,
  provisional = true,
}: {
  title: string;
  children: ReactNode;
  provisional?: boolean;
}) {
  return (
    <div className="wf-page wf-page--narrow">
      <article className={`${card} space-y-5 leading-relaxed`}>
        <h1 className="wf-h1">{title}</h1>
        {provisional ? (
          <p role="note" className="wf-notice">
            Versão provisória. O texto definitivo está sendo preparado pelo nosso advogado e será
            publicado aqui com data e versão.
          </p>
        ) : null}
        {children}
      </article>
    </div>
  );
}
