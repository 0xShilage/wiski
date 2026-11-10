import type { Metadata } from 'next';
import Link from 'next/link';
import { MediaPicture } from '@/components/media/MediaPicture';
import { KIND_ONE as KIND_PT, KIND_PATH } from '@/lib/catalog/kinds';
import { publicQueue } from '@/server/live/public';

export const metadata: Metadata = {
  title: 'Fila',
  description: 'Os filmes, séries e franquias já pagos esperando a vez na live do Wiski.',
};

const when = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/**
 * /fila (2026-11-09): every title already paid — a sponsored movie, a series or franchise with
 * its goal reached — waiting for its turn on the live. Paying for a title moves it here from
 * its tab and opens the slot for another one. What is on screen first, then by date, then the
 * queue order.
 */
export default async function FilaPage() {
  const items = await publicQueue();
  return (
    <div className="wf-page wf-seen">
      <h1 className="wf-h1">Fila</h1>
      <p className="wf-seen__intro">
        Títulos já pagos esperando a vez na live. Quando alguém patrocina um filme ou uma série bate
        a meta, o título vem para cá e abre a vaga para outro na sua aba.
      </p>
      {items.length ? (
        <ol className="wf-seen__grid wf-fila">
          {items.map((it, i) => (
            <li key={it.key}>
              <Link
                href={`/${KIND_PATH[it.kind]}/${it.slug}`}
                className="wf-seen__card"
                prefetch={false}
              >
                <span className="wf-seen__poster" aria-hidden="true">
                  {it.poster ? (
                    <MediaPicture
                      picture={it.poster}
                      alt=""
                      sizes="(max-width: 760px) 45vw, 200px"
                    />
                  ) : null}
                  <span className="wf-fila__n">{i + 1}</span>
                </span>
                <span className="wf-seen__title">{it.title}</span>
                <span className="wf-seen__meta">
                  {KIND_PT[it.kind]}
                  {it.year ? ` · ${it.year}` : ''}
                  {it.jumped ? ' · Fura-fila' : ''}
                </span>
                <span className="wf-seen__meta">
                  {it.kind === 'MOVIE'
                    ? `Patrocínio: ${it.sponsor ?? 'Anônimo'}`
                    : it.lastPart
                      ? `Meta atingida · já vimos até ${it.lastPart}`
                      : 'Meta atingida'}
                </span>
                <span className={it.playing ? 'wf-seen__meta wf-fila__now' : 'wf-seen__meta'}>
                  {it.playing ? (
                    'Passando agora na live'
                  ) : it.when ? (
                    <>
                      Na live de <time dateTime={it.when}>{when.format(new Date(it.when))}</time>
                    </>
                  ) : (
                    'Aguardando data na agenda'
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="wf-seen__intro">
          A fila está vazia.{' '}
          <Link href="/" className="underline">
            Patrocine um filme
          </Link>{' '}
          para ele entrar na próxima live.
        </p>
      )}
    </div>
  );
}
