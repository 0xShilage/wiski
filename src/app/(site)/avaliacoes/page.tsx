import type { Metadata } from 'next';
import Link from 'next/link';
import { Mascote } from '@/components/brand/Mascote';
import { MediaPicture } from '@/components/media/MediaPicture';
import { KIND_LABEL, KIND_PATH } from '@/lib/catalog/kinds';
import { ReviewList } from '@/components/reviews/ReviewList';
import { Stars } from '@/components/reviews/Stars';
import { formatAverage } from '@/lib/reviews/types';
import { getCurrentSession } from '@/server/auth/current';
import { listWatched } from '@/server/catalog/read';
import { latestReviews, ratingsFor } from '@/server/reviews/read';

export const metadata: Metadata = {
  title: 'Avaliações',
  description: 'O que a comunidade achou dos filmes, séries e franquias assistidos na live.',
};

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  timeZone: 'America/Sao_Paulo',
});

/** Avaliações (11 §2.3): the latest reviews across every title, and the titles watched on stream. */
export default async function AvaliacoesPage() {
  const ctx = await getCurrentSession();
  const [watched, latest] = await Promise.all([
    listWatched(24),
    latestReviews(undefined, ctx?.user.id),
  ]);
  const ratings = await ratingsFor(watched.map((w) => w.id));
  return (
    <div className="wf-page">
      <h1 className="wf-h1">Avaliações</h1>
      <p className="wf-lead">
        Depois que um título é assistido na live, a comunidade dá de 1 a 5 estrelas e conta o que
        achou. Abra um título assistido para deixar a sua.
      </p>

      <section className="mt-10" aria-labelledby="ultimas">
        <h2 className="wf-h2" id="ultimas">
          Últimas avaliações
        </h2>
        {latest.reviews.length ? (
          <div className="mt-6">
            <ReviewList
              initial={latest}
              source={{ kind: 'latest' }}
              viewer={{ signedIn: Boolean(ctx), loginHref: '/perfil?returnTo=%2Favaliacoes' }}
              showItem
              empty="Ainda não há avaliações."
            />
          </div>
        ) : (
          <div className="mt-6 flex items-center gap-6 rounded-2xl border border-border/60 bg-surface-1 p-6">
            <div className="w-20 flex-none opacity-80">
              <Mascote pose={2} colour="lavender" />
            </div>
            <p className="wf-muted">
              Ainda não há avaliações. Elas aparecem aqui assim que alguém avaliar um título
              assistido.
            </p>
          </div>
        )}
      </section>

      <section className="mt-12" aria-labelledby="assistidos">
        <h2 className="wf-h2" id="assistidos">
          Assistidos na live
        </h2>
        {watched.length ? (
          <ul className="wf-watched">
            {watched.map((item) => (
              <li key={item.id}>
                <Link
                  href={
                    item.state === 'WATCHED'
                      ? `/${KIND_PATH[item.kind]}/${item.slug}`
                      : '#assistidos'
                  }
                  className="wf-scard"
                  data-tilt
                >
                  <div className="wf-scard__poster">
                    <MediaPicture
                      picture={item.poster}
                      alt=""
                      sizes="(max-width: 760px) 50vw, 200px"
                    />
                  </div>
                  <div className="wf-scard__body">
                    <p className="wf-scard__title text-base">{item.title}</p>
                    {ratings.get(item.id) ? (
                      <p className="wf-scard__rating">
                        <Stars
                          rating={Math.round(ratings.get(item.id)!.average10 / 10)}
                          size="sm"
                        />
                        <span className="text-xs">
                          {formatAverage(ratings.get(item.id)!.average10)} ·{' '}
                          {ratings.get(item.id)!.count}
                        </span>
                      </p>
                    ) : null}
                    <p className="wf-muted text-xs">
                      Assistido em {dateFmt.format(new Date(item.watchedAt))}
                      {/* The link's name is its visible text (WCAG 2.5.3) plus the kind. */}
                      <span className="sr-only"> ({KIND_LABEL[item.kind].one.toLowerCase()})</span>
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wf-muted mt-4">Nenhum título assistido ainda.</p>
        )}
      </section>
    </div>
  );
}
