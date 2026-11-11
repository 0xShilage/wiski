import Link from 'next/link';
import { ContributionForm } from '@/components/checkout/ContributionForm';
import { MovieCheckout } from '@/components/checkout/MovieCheckout';
import { QueueCard } from '@/components/live/QueueCard';
import { MediaPicture } from '@/components/media/MediaPicture';
import type { CheckoutProps } from '@/lib/checkout/types';
import { KIND_LABEL, KIND_PATH } from '@/lib/catalog/kinds';
import { formatRuntime } from '@/lib/catalog/pricing';
import type { PublicItem } from '@/lib/catalog/types';
import type { TitleQueueStatus } from '@/lib/queue-position';
import {
  CampaignChips,
  CampaignProgress,
  CampaignStatus,
  ContributeCta,
  campaignSubtitle,
} from './CampaignBits';
import { AmbientGlow } from './AmbientGlow';
import { MetaRow } from './MetaRow';
import { SeatMap } from './SeatMap';
import { PriceLine, SponsorCta } from './SponsorLine';
import { TrailerButton } from './TrailerButton';

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
  timeZone: 'America/Sao_Paulo',
});

/**
 * Shareable detail page for a movie, series or franchise (11 §3); checkout lives in the aside, and
 * — for a paid or funded title — where it stands in the queue (2026-11-04).
 */
/** 1–4: which slow pan the backdrop gets (stable per title, varied between titles). */
const kenBurns = (slug: string) => 1 + ([...slug].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 4);

export function ItemDetail({
  item,
  checkout,
  queue,
}: {
  item: PublicItem;
  checkout?: CheckoutProps;
  queue?: TitleQueueStatus | null;
}) {
  const watchedAt = item.watchedAt;
  const canPay = Boolean(checkout?.open && checkout.legal);
  const kindPath = KIND_PATH[item.kind];
  const back = item.kind === 'MOVIE' ? '/' : `/${kindPath}`;
  return (
    <article className="wf-detail" aria-labelledby="titulo">
      {/* Ken Burns (2026-11-11): one of four slow pans, picked by the slug so it stays the same */}
      <div className="wf-detail__art" aria-hidden="true" data-kb={kenBurns(item.slug)}>
        <MediaPicture picture={item.backdrop} alt="" sizes="100vw" priority />
      </div>
      <div className="wf-detail__shade" aria-hidden="true" />
      {/* ambient glow (2026-11-11): the poster's colour lighting the hero */}
      <AmbientGlow color={item.accent} part="wash" />
      <div className="wf-page">
        <p>
          <Link href={back} className="text-sm text-fg-muted underline-offset-4 hover:underline">
            ← {KIND_LABEL[item.kind].many}
          </Link>
        </p>
        <div className="wf-detail__grid">
          <div className="wf-detail__postercell">
            <AmbientGlow color={item.accent} part="halo" />
            <div className="wf-detail__poster">
              <MediaPicture picture={item.poster} alt={`Pôster de ${item.title}`} sizes="300px" />
            </div>
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
            {queue ? <QueueCard status={queue} /> : null}
            {item.state === 'WATCHED' ? (
              <div className="wf-panel">
                <h2>Assistido na live</h2>
                <p className="wf-muted">
                  {watchedAt ? `Em ${dateFmt.format(new Date(watchedAt))}. ` : ''}Viu com a gente?
                  Dê sua nota de 1 a 5 e conte o que achou.
                </p>
                <a href="#avaliacoes" className="wf-btn wf-btn--neon">
                  Ver e escrever avaliações
                </a>
              </div>
            ) : item.kind === 'MOVIE' ? (
              <div className="wf-panel" id="patrocinar">
                <h2>Patrocinar este filme</h2>
                <PriceLine item={item} className="wf-muted" />
                {item.state === 'ACTIVE' && canPay && checkout ? (
                  <MovieCheckout movieId={item.id} props={checkout} />
                ) : (
                  <>
                    {item.state === 'ACTIVE' ? (
                      // checkout closed: on this page the CTA would only link to itself
                      <span className="wf-btn wf-btn--done" aria-disabled="true">
                        Patrocine agora
                      </span>
                    ) : (
                      <SponsorCta item={item} />
                    )}
                    {item.state === 'ACTIVE' ? (
                      <p className="wf-notice mt-4">
                        {checkout?.closedCopy ?? 'O pagamento com Pix abre em breve.'} Uma pessoa
                        paga o filme inteiro; ele entra numa das próximas sessões da live.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : item.campaign ? (
              <div className="wf-panel" id="contribuir">
                <h2>Campanha coletiva</h2>
                <SeatMap campaign={item.campaign} />
                <CampaignProgress c={item.campaign} />
                <CampaignStatus c={item.campaign} />
                <CampaignChips c={item.campaign} />
                {item.campaign.state === 'OPEN' && item.state === 'ACTIVE' && canPay && checkout ? (
                  <ContributionForm
                    campaignId={item.campaign.id}
                    remainingCents={item.campaign.remainingCents}
                    props={checkout}
                  />
                ) : (
                  <>
                    {item.campaign.state === 'OPEN' ? (
                      // checkout closed: on this page the CTA would only link to itself
                      <span className="wf-btn wf-btn--done" aria-disabled="true">
                        Contribuir
                      </span>
                    ) : (
                      <ContributeCta item={item} kindPath={kindPath} />
                    )}
                    {item.campaign.state === 'OPEN' ? (
                      <p className="wf-notice mt-4">
                        {checkout?.closedCopy ?? 'As contribuições com Pix abrem em breve.'}{' '}
                        Qualquer valor a partir de R$ 5, sem ultrapassar a meta.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </article>
  );
}
