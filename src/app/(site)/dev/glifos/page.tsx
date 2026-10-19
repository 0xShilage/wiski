import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { card, container } from '@/components/ui/styles';

export const metadata: Metadata = { title: 'Teste de glifos', robots: { index: false } };

/** pt-BR glyph coverage check for the three fonts (10 §2 step 6). Not available in production. */
export const SAMPLES = [
  'AÇÃO CORAÇÃO PÃO AVÓ VOCÊ À ÜBER',
  'ação coração pão avó você à über',
  'Á É Í Ó Ú Â Ê Ô Ã Õ Ç á é í ó ú â ê ô ã õ ç',
  'R$ 1.234,56 — “aspas” ‘simples’ … • nº 1º 2ª',
];

export default function GlifosPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const fonts = [
    { label: 'Poppins (font-sans)', className: 'font-sans' },
    { label: 'Escargoth (font-display)', className: 'font-display' },
    { label: 'Black Rockie (font-brand)', className: 'font-brand' },
  ];
  return (
    <div className={`${container} space-y-6 py-10`}>
      <h1 className="text-h2 font-semibold">Teste de glifos pt-BR</h1>
      {fonts.map((f) => (
        <section key={f.label} className={card} data-font={f.className}>
          <h2 className="mb-3 text-sm text-fg-muted">{f.label}</h2>
          {SAMPLES.map((s) => (
            <p key={s} className={`${f.className} text-2xl`} data-sample>
              {s}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
