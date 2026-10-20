import { LEGAL_TEXTS, type LegalType } from '@/content/legal/documents';
import { LegalPlaceholder } from './LegalPlaceholder';

/**
 * A versioned legal text exactly as accepted at checkout (src/content/legal): the version shown
 * here is the one stored with every order.
 */
export function LegalDocument({ type }: { type: LegalType }) {
  const t = LEGAL_TEXTS[type];
  return (
    <LegalPlaceholder title={t.title} provisional={t.provisional}>
      <p className="wf-muted text-sm">Versão {t.version}</p>
      {t.blocks.map((b, i) => {
        if ('h2' in b) {
          return (
            <h2 key={i} id={b.id} className="wf-h2 pt-2">
              {b.h2}
            </h2>
          );
        }
        if ('list' in b) {
          return (
            <ul key={i} className="list-disc space-y-2 pl-6">
              {b.list.map((li, j) => (
                <li key={j}>{li}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{b.p}</p>;
      })}
    </LegalPlaceholder>
  );
}
