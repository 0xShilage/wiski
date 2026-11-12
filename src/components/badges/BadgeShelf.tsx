import type { BadgeView } from '@/lib/badges';
import { BadgeArt } from './BadgeArt';

const month = new Intl.DateTimeFormat('pt-BR', {
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

/**
 * A collection of event badges (2026-11-12) on /perfil and /u/[username]: the art, the name and
 * when it was claimed. The name stays readable without the picture.
 */
export function BadgeShelf({ items, labelledBy }: { items: BadgeView[]; labelledBy: string }) {
  return (
    <ul className="wf-badge-shelf" aria-labelledby={labelledBy}>
      {items.map((b) => (
        <li key={b.id} className="wf-badge-shelf__item">
          <BadgeArt picture={b.picture} still={b.still} name={b.name} size={88} />
          <span className="wf-badge-shelf__name">{b.name}</span>
          {b.claimedAt ? (
            <span className="wf-badge-shelf__when">
              {month.format(new Date(b.claimedAt)).replace('.', '')}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
