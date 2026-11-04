'use client';
import Link from 'next/link';
import { MediaPicture } from '@/components/media/MediaPicture';
import {
  type CatalogFilter,
  filterCatalog,
  genresOf,
  isFiltering,
  MOVIE_SORTS,
} from '@/lib/catalog/filter';
import type { PublicItem } from '@/lib/catalog/types';
import { formatBRL, formatRuntime } from '@/lib/catalog/pricing';
import { CatalogFilterBar, useCatalogFilter } from './CatalogFilterBar';

/**
 * "Filmes disponíveis" (2026-11-02), just below the home carousel: every movie that can be
 * sponsored right now, all at once (the carousel shows a few at a time). A movie someone is paying
 * for (Pix pending) stays listed as "Reservado"; sponsored and watched ones leave the grid.
 * Filters and sort (2026-11-04): busca, gênero, duração, ordem — kept in the address.
 * The cards don't prefetch: a few dozen title pages per visit would eat into nginx's per-IP
 * request burst (shared mobile IPs, and the browser tests), and a click still opens them at once.
 */
export function MovieGrid({
  items,
  initialFilter,
}: {
  items: PublicItem[];
  initialFilter: CatalogFilter;
}) {
  const [filter, setFilter] = useCatalogFilter(initialFilter);
  const available = items.filter((i) => i.state === 'ACTIVE' || i.state === 'RESERVED');
  if (!available.length) return null;
  const free = available.filter((i) => i.state === 'ACTIVE').length;
  const shown = filterCatalog(available, filter);
  return (
    <section className="wf-movie-grid" aria-labelledby="filmes-disponiveis">
      <h2 id="filmes-disponiveis" className="wf-h2">
        Filmes disponíveis
      </h2>
      <p className="wf-muted text-sm">
        {free === 1 ? '1 filme esperando patrocínio' : `${free} filmes esperando patrocínio`}
      </p>
      <CatalogFilterBar
        filter={filter}
        onChange={setFilter}
        genres={genresOf(available)}
        sorts={MOVIE_SORTS}
        showDuration
        shown={shown.length}
        total={available.length}
        noun={['filme', 'filmes']}
      />
      {shown.length ? (
        <ul className="wf-grid wf-grid--movies list-none p-0">
          {shown.map((m) => (
            <li key={m.id} className="flex">
              <Link href={`/filmes/${m.slug}`} className="wf-scard w-full" prefetch={false}>
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
      ) : (
        <p className="wf-filters__empty">
          {isFiltering(filter)
            ? 'Nenhum filme com esses filtros. Tente outro gênero ou duração.'
            : 'Nenhum filme agora.'}
        </p>
      )}
    </section>
  );
}
