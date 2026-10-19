import type { Metadata } from 'next';
import Link from 'next/link';
import { Mascote } from '@/components/brand/Mascote';
import { MediaPicture } from '@/components/media/MediaPicture';
import { KIND_LABEL, KIND_PATH } from '@/lib/catalog/kinds';
import { listWatched } from '@/server/catalog/read';

export const metadata: Metadata = {
  title: 'Avaliações',
  description: 'O que a comunidade achou dos filmes, séries e franquias assistidos na live.',
};

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  timeZone: 'America/Sao_Paulo',
});

/** Avaliações (11 §2.3) — R1 shell: watched titles now; review writing arrives in Phase 3. */
export default async function AvaliacoesPage() {
  const watched = await listWatched(24);
  return (
    <div className="wf-page">
      <h1 className="wf-h1">Avaliações</h1>
      <p className="wf-lead">
        Depois que um título é assistido na live, a comunidade dá de 1 a 5 estrelas e conta o que
        achou. As avaliações abrem em breve.
      </p>

      <section className="mt-10" aria-labelledby="ultimas">
        <h2 className="wf-h2" id="ultimas">
          Últimas avaliações
        </h2>
        <div className="mt-6 flex items-center gap-6 rounded-2xl border border-border/60 bg-surface-1 p-6">
          <div className="w-20 flex-none opacity-80">
            <Mascote pose={2} colour="lavender" />
          </div>
          <p className="wf-muted">Ainda não há avaliações. Elas aparecem aqui assim que abrirem.</p>
        </div>
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
