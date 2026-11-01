import type { Metadata } from 'next';
import Link from 'next/link';
import { hoursMinutes } from '@/components/live/ProgressBlock';
import { MediaPicture } from '@/components/media/MediaPicture';
import { KIND_PATH } from '@/lib/catalog/kinds';
import { watchProgress } from '@/server/catalog/progress';
import { watchedTitles } from '@/server/catalog/read';

export const metadata: Metadata = {
  title: 'Assistidos',
  description: 'Os filmes, séries e franquias que já passaram na live do Wiski.',
};

const FILTERS = [
  { tipo: null, label: 'Todos', kind: undefined },
  { tipo: 'filmes', label: 'Filmes', kind: 'MOVIE' },
  { tipo: 'series', label: 'Séries', kind: 'SERIES' },
  { tipo: 'franquias', label: 'Franquias', kind: 'FRANCHISE' },
] as const;
const KIND_PT = { MOVIE: 'Filme', SERIES: 'Série', FRANCHISE: 'Franquia' } as const;
const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * /assistidos (2026-11-01): everything already watched on stream, newest first, with a filter
 * per kind (plain links, no script). Each card opens the title's page, where the reviews are.
 */
export default async function AssistidosPage({ searchParams }: Props) {
  const tipo = (await searchParams).tipo;
  const filter = FILTERS.find((f) => f.tipo === tipo) ?? FILTERS[0];
  const [items, progress] = await Promise.all([watchedTitles(filter.kind), watchProgress()]);
  return (
    <div className="wf-page wf-watched">
      <h1 className="wf-h1">Assistidos</h1>
      <p className="wf-watched__intro">
        Tudo o que já passou na live: {progress.watched.total}{' '}
        {progress.watched.total === 1 ? 'título' : 'títulos'},{' '}
        {hoursMinutes(progress.minutes.total)} no total. Abra um título para ler as avaliações ou
        deixar a sua.
      </p>
      <nav className="wf-seg wf-watched__filter" aria-label="Filtrar por tipo">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={f.tipo ? `/assistidos?tipo=${f.tipo}` : '/assistidos'}
            className={f === filter ? 'is-on' : ''}
            aria-current={f === filter ? 'page' : undefined}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {items.length ? (
        <ul className="wf-watched__grid">
          {items.map((it) => (
            <li key={it.id}>
              <Link href={`/${KIND_PATH[it.kind]}/${it.slug}`} className="wf-watched__card">
                <span className="wf-watched__poster" aria-hidden="true">
                  {it.poster ? (
                    <MediaPicture
                      picture={it.poster}
                      alt=""
                      sizes="(max-width: 760px) 45vw, 200px"
                    />
                  ) : null}
                </span>
                <span className="wf-watched__title">{it.title}</span>
                <span className="wf-watched__meta">
                  {KIND_PT[it.kind]}
                  {it.year ? ` · ${it.year}` : ''}
                </span>
                <span className="wf-watched__meta">
                  Assistido em{' '}
                  <time dateTime={it.watchedAt}>{date.format(new Date(it.watchedAt))}</time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="wf-watched__intro">
          {filter.kind ? 'Nada deste tipo foi assistido ainda.' : 'Nada foi assistido ainda.'}{' '}
          <Link href="/" className="underline">
            Patrocine um filme
          </Link>{' '}
          para ele entrar na próxima live.
        </p>
      )}
    </div>
  );
}
