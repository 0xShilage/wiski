'use client';
import Link from 'next/link';
import { MediaPicture } from '@/components/media/MediaPicture';
import {
  CAMPAIGN_SORTS,
  type CatalogFilter,
  filterCatalog,
  genresOf,
  isFiltering,
} from '@/lib/catalog/filter';
import type { PublicItem } from '@/lib/catalog/types';
import { CampaignProgress, CampaignStatus, campaignSubtitle } from './CampaignBits';
import { CatalogFilterBar, useCatalogFilter } from './CatalogFilterBar';

/**
 * Séries / Franquias campaign cards with filters and sort (2026-11-04). Without a filter the
 * featured campaign stays in its own block above; with one, every match is listed here.
 */
export function CampaignGrid({
  items,
  featuredId,
  kindPath,
  title,
  initialFilter,
}: {
  items: PublicItem[];
  featuredId: string | null;
  kindPath: 'series' | 'franquias';
  title: string;
  initialFilter: CatalogFilter;
}) {
  const [filter, setFilter] = useCatalogFilter(initialFilter);
  if (items.length < 2) return null;
  const filtering = isFiltering(filter);
  const pool = filtering ? items : items.filter((i) => i.id !== featuredId);
  const shown = filterCatalog(pool, filter);
  const noun: [string, string] =
    kindPath === 'series' ? ['série', 'séries'] : ['franquia', 'franquias'];
  return (
    <section className="wf-campaign-grid" aria-label={`Campanhas de ${title.toLowerCase()}`}>
      <CatalogFilterBar
        filter={filter}
        onChange={setFilter}
        genres={genresOf(items)}
        sorts={CAMPAIGN_SORTS}
        showDuration={false}
        shown={shown.length}
        total={items.length}
        noun={noun}
      />
      {shown.length ? (
        <ul
          className="wf-grid list-none p-0"
          aria-label={
            filtering ? `${title} encontradas` : `Outras campanhas de ${title.toLowerCase()}`
          }
        >
          {shown.map((item) => (
            <li key={item.id} className="flex">
              <Link href={`/${kindPath}/${item.slug}`} className="wf-scard w-full">
                <div className="wf-scard__poster">
                  <MediaPicture
                    picture={item.poster}
                    alt=""
                    sizes="(max-width: 760px) 50vw, (max-width: 1440px) 25vw, 320px"
                  />
                </div>
                <div className="wf-scard__body">
                  <h3 className="wf-scard__title">{item.title}</h3>
                  <p className="wf-muted text-sm">{campaignSubtitle(item)}</p>
                  {item.campaign ? (
                    <>
                      <CampaignProgress c={item.campaign} size="sm" />
                      <CampaignStatus c={item.campaign} />
                    </>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : filtering ? (
        <p className="wf-filters__empty">
          Nenhuma {noun[0]} com esses filtros. Tente outro gênero ou limpe a busca.
        </p>
      ) : null}
    </section>
  );
}
