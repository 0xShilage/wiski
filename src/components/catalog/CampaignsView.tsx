import Link from 'next/link';
import { Mascote } from '@/components/brand/Mascote';
import { MediaPicture } from '@/components/media/MediaPicture';
import type { CatalogFilter } from '@/lib/catalog/filter';
import type { PublicItem } from '@/lib/catalog/types';
import { AgeBadge } from './AgeBadge';
import { CampaignGrid } from './CampaignGrid';
import { CampaignChips, CampaignProgress, ContributeCta, campaignSubtitle } from './CampaignBits';
import { TrailerButton } from './TrailerButton';

/**
 * Séries / Franquias (11 §3, design §4): how crowdfunding works, a featured campaign and the
 * grid of campaign cards (open · meta atingida · prazo encerrado), with filters (2026-11-04).
 */
export function CampaignsView({
  title,
  lead,
  kindPath,
  items,
  initialFilter,
}: {
  title: string;
  lead: string;
  kindPath: 'series' | 'franquias';
  items: PublicItem[];
  initialFilter: CatalogFilter;
}) {
  const featured =
    items.find((i) => i.campaign?.state === 'OPEN' && i.campaign.raisedCents > 0) ?? items[0];
  return (
    <div className="wf-page">
      <h1 className="wf-h1">{title}</h1>
      <p className="wf-lead">{lead}</p>

      {!featured ? (
        <div className="mt-12 grid place-items-center gap-6 text-center">
          <div className="w-40 opacity-80">
            <Mascote pose={3} colour="lavender" />
          </div>
          <p className="wf-muted">Nenhuma campanha aberta agora. Volte em breve!</p>
        </div>
      ) : (
        <article className="wf-feature" aria-labelledby={`f-${featured.id}`}>
          <div className="wf-feature__art">
            <MediaPicture
              picture={featured.backdrop}
              alt=""
              sizes="(max-width: 960px) 100vw, 56vw"
              priority
            />
          </div>
          <div className="wf-feature__info">
            <p className="wf-kicker">Campanha em destaque</p>
            <h2 className="wf-feature__title" id={`f-${featured.id}`}>
              <Link href={`/${kindPath}/${featured.slug}`} className="hover:underline">
                {featured.title}
              </Link>
            </h2>
            <p className="wf-muted flex flex-wrap items-center gap-2 text-sm">
              <span>{campaignSubtitle(featured)}</span>
              <AgeBadge rating={featured.ageRating} />
            </p>
            {featured.campaign ? (
              <>
                <CampaignProgress c={featured.campaign} />
                <CampaignChips c={featured.campaign} />
              </>
            ) : null}
            <div className="wf-feature__ctas">
              <TrailerButton youtubeId={featured.trailerYoutubeId} title={featured.title} />
              <ContributeCta item={featured} kindPath={kindPath} />
            </div>
          </div>
        </article>
      )}

      <CampaignGrid
        items={items}
        featuredId={featured?.id ?? null}
        kindPath={kindPath}
        title={title}
        initialFilter={initialFilter}
      />
    </div>
  );
}
