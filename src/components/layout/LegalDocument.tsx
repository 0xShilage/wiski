import type { ReactNode } from 'react';
import { card } from '@/components/ui/styles';
import { LEGAL_CONTROLLER, LEGAL_TEXT, LEGAL_TITLE, LEGAL_UPDATED } from '@/content/legal/privacy';
import { REFUND_TEXT, REFUND_TITLE, REFUND_UPDATED } from '@/content/legal/refund';
import { type Block, type Inline, parseLegal } from '@/lib/legal-text';

const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function updatedLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

function renderInline(parts: Inline[]): ReactNode[] {
  return parts.map((p, i) => {
    switch (p.t) {
      case 'text':
        return p.v;
      case 'b':
        return <strong key={i}>{renderInline(p.v)}</strong>;
      case 'a':
        return (
          <a key={i} className="wf-legal__link" href={p.href} rel="noopener noreferrer">
            {p.href}
          </a>
        );
      case 'blank':
        if (!p.v)
          return (
            <mark key={i} className="wf-legal__blank">
              [a definir]
            </mark>
          );
        return EMAIL.test(p.v) ? (
          <a key={i} className="wf-legal__link" href={`mailto:${p.v}`}>
            {p.v}
          </a>
        ) : (
          p.v
        );
    }
  });
}

const DOCS = {
  privacy: {
    title: LEGAL_TITLE,
    kind: 'Termos de uso e privacidade',
    updated: LEGAL_UPDATED,
    text: LEGAL_TEXT,
    signed: true, // the signature block is drawn below the text
  },
  refund: {
    title: REFUND_TITLE,
    kind: 'Reembolso',
    updated: REFUND_UPDATED,
    text: REFUND_TEXT,
    signed: false, // the closing block is part of the text itself
  },
} as const;

/**
 * The legal pages: /privacidade ("Política de Privacidade e Proteção de Dados", which also stands
 * in for the old Termos de uso, 2026-11-01) and /reembolso (the refund terms, 2026-11-03). Text
 * from src/content/legal, rendered as text nodes; numbered sections get stable anchors (#secao-1,
 * #secao-6-2…) and a table of contents.
 */
export function LegalDocument({ doc = 'privacy' }: { doc?: keyof typeof DOCS }) {
  const d = DOCS[doc];
  const blocks = parseLegal(d.text, LEGAL_CONTROLLER);
  const sections = blocks.filter((b): b is Extract<Block, { kind: 'h2' }> => b.kind === 'h2');
  const missing = [...d.text.matchAll(/\{([a-z]+)\}/g)].some(
    (m) => !LEGAL_CONTROLLER[m[1] as keyof typeof LEGAL_CONTROLLER],
  );
  const updated = updatedLabel(d.updated);
  return (
    <div className="wf-page wf-page--narrow">
      <article className={`${card} wf-legal`}>
        <header className="wf-legal__head">
          <h1 className="wf-h1">{d.title}</h1>
          <p className="wf-legal__meta">
            {d.kind} · Última atualização: <time dateTime={d.updated}>{updated}</time>
          </p>
        </header>
        {missing ? (
          <p role="note" className="wf-notice">
            Versão provisória: alguns dados de identificação ainda estão marcados como “a definir” e
            serão preenchidos antes da publicação definitiva.
          </p>
        ) : null}
        <nav aria-label="Seções" className="wf-legal__toc">
          <ol>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.text.replace(/^\d+\.\s*/, '')}</a>
              </li>
            ))}
          </ol>
        </nav>
        {blocks.map((b, i) => {
          if (b.kind === 'h2')
            return (
              <h2 key={i} id={b.id} className="wf-legal__h2">
                {b.text}
              </h2>
            );
          if (b.kind === 'h3')
            return (
              <h3 key={i} id={b.id} className="wf-legal__h3">
                {b.text}
              </h3>
            );
          if (b.kind === 'ul')
            return (
              <ul key={i} className="wf-legal__list">
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          return <p key={i}>{renderInline(b.inlines)}</p>;
        })}
        {d.signed ? (
          <footer className="wf-legal__sign">
            <p>
              <strong>
                {renderInline([{ t: 'blank', key: 'controller', v: LEGAL_CONTROLLER.controller }])}
              </strong>
            </p>
            <p>
              <strong>{LEGAL_CONTROLLER.site}</strong>
            </p>
            <p>Última atualização: {updated}.</p>
          </footer>
        ) : null}
      </article>
    </div>
  );
}
