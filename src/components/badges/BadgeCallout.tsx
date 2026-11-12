import Link from 'next/link';
import type { BadgeView } from '@/lib/badges';
import { BadgeArt } from './BadgeArt';

const until = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/**
 * The home page's nudge (2026-11-12) while an event badge is open: its art, its name, until when —
 * and the way to /emblemas. Nothing renders when no badge is open.
 */
export function BadgeCallout({ badges }: { badges: BadgeView[] }) {
  const first = badges[0];
  if (!first) return null;
  const more = badges.length - 1;
  return (
    <section className="wf-badge-callout" aria-labelledby="emblema-aberto">
      <Link href="/emblemas" className="wf-badge-callout__card">
        <BadgeArt picture={first.picture} still={first.still} name={first.name} size={72} />
        <span className="wf-badge-callout__text">
          <span className="wf-badge-callout__eyebrow">Emblema de evento · edição limitada</span>
          <span id="emblema-aberto" className="wf-badge-callout__name">
            {first.name}
          </span>
          <span className="wf-badge-callout__until">
            Resgate até {until.format(new Date(first.endsAt)).replace('.', '')}
            {more > 0 ? ` · e mais ${more === 1 ? '1 aberto' : `${more} abertos`}` : ''}
          </span>
        </span>
        <span className="wf-badge-callout__cta" aria-hidden="true">
          Resgatar →
        </span>
      </Link>
    </section>
  );
}
