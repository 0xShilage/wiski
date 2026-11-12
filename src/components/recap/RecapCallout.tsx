import Link from 'next/link';

/**
 * The way into "Seu ano na Wiskiflix" (2026-11-12): on the home page in December and January, and
 * always on /perfil.
 */
export function RecapCallout({ year, home = false }: { year: number; home?: boolean }) {
  const card = (
    <Link href="/retrospectiva" className="wf-recap-callout__card">
      <span>
        <span className="wf-recap-callout__title">Seu ano na Wiskiflix</span>
        <span className="wf-recap-callout__sub">
          Retrospectiva {year}: o que você patrocinou, avaliou e colecionou.
        </span>
      </span>
      <span className="wf-recap-callout__cta" aria-hidden="true">
        Ver agora →
      </span>
    </Link>
  );
  return home ? (
    <section className="wf-recap-callout" aria-label={`Retrospectiva ${year}`}>
      {card}
    </section>
  ) : (
    card
  );
}
