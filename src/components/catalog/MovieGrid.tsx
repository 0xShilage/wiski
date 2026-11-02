import Link from 'next/link';
import { MediaPicture } from '@/components/media/MediaPicture';
import type { PublicItem } from '@/lib/catalog/types';
import { formatBRL, formatRuntime } from '@/lib/catalog/pricing';

/**
 * "Filmes disponíveis" (2026-11-02), just below the home carousel: every movie that can be
 * sponsored right now, all at once (the carousel shows a few at a time). A movie someone is paying
 * for (Pix pending) stays listed as "Reservado"; sponsored and watched ones leave the grid.
 */
export function MovieGrid({ items }: { items: PublicItem[] }) {
  const available = items.filter((i) => i.state === 'ACTIVE' || i.state === 'RESERVED');
  if (!available.length) return null;
  const free = available.filter((i) => i.state === 'ACTIVE').length;
  return (
    <section className="wf-movie-grid" aria-labelledby="filmes-disponiveis">
      <h2 id="filmes-disponiveis" className="wf-h2">
        Filmes disponíveis
      </h2>
      <p className="wf-muted text-sm">
        {free === 1 ? '1 filme esperando patrocínio' : `${free} filmes esperando patrocínio`}
      </p>
      <ul className="wf-grid wf-grid--movies list-none p-0">
        {available.map((m) => (
          <li key={m.id} className="flex">
            <Link href={`/filmes/${m.slug}`} className="wf-scard w-full">
              <div className="wf-scard__poster">
                <MediaPicture
                  picture={m.poster}
                  alt=""
                  sizes="(max-width: 760px) 50vw, (max-width: 1440px) 17vw, 220px"
                />
                {m.state === 'RESERVED' ? (
                  <span className="wf-badge wf-badge--reserved">Reservado</span>
                ) : null}
              </div>
              <div className="wf-scard__body">
                <h3 className="wf-scard__title">{m.title}</h3>
                <p className="wf-muted m-0 text-sm">
                  {[m.year, formatRuntime(m.runtimeMinutes)].filter(Boolean).join(' · ')}
                </p>
                {m.state === 'ACTIVE' && m.priceCents ? (
                  <p className="wf-movie-grid__price">{formatBRL(m.priceCents)}</p>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
