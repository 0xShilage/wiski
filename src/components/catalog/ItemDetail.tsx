import Link from 'next/link';
import { MediaPicture } from '@/components/media/MediaPicture';
import { KIND_LABEL, KIND_PATH } from '@/lib/catalog/kinds';
import { formatRuntime } from '@/lib/catalog/pricing';
import type { PublicItem } from '@/lib/catalog/types';
import { CampaignPanel } from '@/components/checkout/CampaignPanel';
import { MovieCheckout } from '@/components/checkout/MovieCheckout';
import type { CheckoutContext } from '@/components/checkout/types';
import { campaignSubtitle } from './CampaignBits';
import { MetaRow } from './MetaRow';
import { PriceLine, SponsorCta } from './SponsorLine';
import { TrailerButton } from './TrailerButton';

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
  timeZone: 'America/Sao_Paulo',
});

/** Shareable detail page for a movie, series or franchise (11 §3). */
export function ItemDetail({
  item,
  watchedAt,
  checkout,
}: {
  item: PublicItem;
  watchedAt?: string | null;
  checkout: CheckoutContext;
}) {
  const kindPath = KIND_PATH[item.kind];
  const back = item.kind === 'MOVIE' ? '/' : `/${kindPath}`;
  return (
    <article className="wf-detail" aria-labelledby="titulo">
      <div className="wf-detail__art" aria-hidden="true">
        <MediaPicture picture={item.backdrop} alt="" sizes="100vw" priority />
      </div>
      <div className="wf-detail__shade" aria-hidden="true" />
      <div className="wf-page">
        <p>
          <Link href={back} className="text-sm text-fg-muted underline-offset-4 hover:underline">
            ← {KIND_LABEL[item.kind].many}
          </Link>
        </p>
        <div className="wf-detail__grid">
          <div className="wf-detail__poster">
            <MediaPicture picture={item.poster} alt={`Pôster de ${item.title}`} sizes="300px" />
          </div>

          <div>
            <p className="wf-kicker">{KIND_LABEL[item.kind].one}</p>
            <h1 className="wf-h1 mt-2" id="titulo">
              {item.title}
            </h1>
            {item.originalTitle ? (
              <p className="wf-muted mt-2 italic">{item.originalTitle}</p>
            ) : null}
            <MetaRow
              className="mt-4"
              ageRating={item.ageRating}
              year={item.year}
              runtimeMinutes={item.kind === 'MOVIE' ? item.runtimeMinutes : null}
              genres={item.genres}
              extra={item.kind === 'MOVIE' ? null : campaignSubtitle(item)}
            />
            <p className="wf-detail__synopsis">{item.synopsis}</p>
            <div className="mt-6 flex flex-wrap gap-4">
              <TrailerButton youtubeId={item.trailerYoutubeId} title={item.title} />
            </div>
            {item.director || item.cast.length ? (
              <dl>
                {item.director ? (
                  <>
                    <dt>Direção</dt>
                    <dd>{item.director}</dd>
                  </>
                ) : null}
                {item.cast.length ? (
                  <>
                    <dt>Elenco</dt>
                    <dd>{item.cast.join(', ')}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
            {item.kind === 'FRANCHISE' && item.films.length ? (
              <section className="mt-8" aria-labelledby="filmes-incluidos">
                <h2 className="wf-h2" id="filmes-incluidos">
                  Filmes incluídos
                </h2>
                <ol className="wf-films">
                  {item.films.map((f) => (
                    <li key={f.position}>
                      <span>
                        {f.title}
                        {f.year ? <span className="wf-muted"> ({f.year})</span> : null}
                      </span>
                      <span className="wf-muted text-sm">{formatRuntime(f.runtimeMinutes)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </div>

          <aside className="wf-detail__aside">
            {item.state === 'WATCHED' ? (
              <div className="wf-panel">
                <h2>Assistido na live</h2>
                <p className="wf-muted">
                  {watchedAt ? `Em ${dateFmt.format(new Date(watchedAt))}. ` : ''}As avaliações da
                  comunidade abrem em breve.
                </p>
                <Link href="/avaliacoes" className="wf-btn wf-btn--ghost">
                  Ver avaliações
                </Link>
              </div>
            ) : item.kind === 'MOVIE' ? (
              <div className="wf-panel" id="patrocinar">
                <h2>Patrocinar este filme</h2>
                <PriceLine item={item} className="wf-muted" />
                {item.state === 'ACTIVE' ? (
                  <>
                    <MovieCheckout
                      ctx={checkout}
                      item={{
                        id: item.id,
                        slug: item.slug,
                        title: item.title,
                        priceCents: item.priceCents,
                      }}
                    />
                    <p className="wf-hint mt-3">
                      Uma pessoa paga o filme inteiro, por Pix. Ele entra numa das próximas sessões
                      da live.
                    </p>
                  </>
                ) : (
                  <SponsorCta item={item} />
                )}
              </div>
            ) : item.campaign ? (
              <CampaignPanel ctx={checkout} title={item.title} campaign={item.campaign} />
            ) : null}
          </aside>
        </div>
      </div>
    </article>
  );
}
