import type { Metadata } from 'next';
import Link from 'next/link';
import { hoursMinutes } from '@/components/live/ProgressBlock';
import { MediaPicture } from '@/components/media/MediaPicture';
import { IconSearch } from '@/components/ui/icons';
import { KIND_ONE, KIND_PATH } from '@/lib/catalog/kinds';
import { SEARCH_MAX, searchTerms } from '@/lib/search';
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
  { tipo: 'animes', label: 'Animes', kind: 'ANIME' },
] as const;
const KIND_PT = KIND_ONE;
const num = new Intl.NumberFormat('pt-BR');
const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/** /assistidos with the kind and the search kept; either can be left out. */
function hrefFor(tipo: string | null, q: string): string {
  const params = new URLSearchParams();
  if (tipo) params.set('tipo', tipo);
  if (q) params.set('q', q);
  const qs = params.toString();
  return qs ? `/assistidos?${qs}` : '/assistidos';
}

/**
 * /assistidos (2026-11-01): everything already watched on stream, newest first, with a filter
 * per kind (plain links, no script) and (2026-11-03) a search by name — a plain GET form, so it
 * works without JavaScript. Each card opens the title's page, where the reviews are.
 * Poster wall of fame (2026-11-11): the titles are a dense grid of posters, inside the page column,
 * under a "N títulos · X h juntos na live" headline; the title, kind and date show over the poster
 * on hover or keyboard focus (on touch screens the title is always on it).
 */
export default async function AssistidosPage({ searchParams }: Props) {
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.tipo === one(params.tipo)) ?? FILTERS[0];
  const q = (one(params.q) ?? '').trim().slice(0, SEARCH_MAX);
  const searching = searchTerms(q).length > 0;
  const [items, progress] = await Promise.all([
    watchedTitles(filter.kind, searching ? q : null),
    watchProgress(),
  ]);
  return (
    <div className="wf-page wf-seen">
      <h1 className="wf-h1">Assistidos</h1>
      <p className="wf-fame__stat">
        <span>
          <strong>{num.format(progress.watched.total)}</strong>{' '}
          {progress.watched.total === 1 ? 'título' : 'títulos'}
        </span>
        <span aria-hidden="true" className="wf-fame__dot">
          ·
        </span>
        <span>
          <strong>{hoursMinutes(progress.minutes.total)}</strong> juntos na live
        </span>
      </p>
      <p className="wf-seen__intro">
        A nossa parede da fama: tudo o que já passou na live. Os marcados “fora da live” a Iara
        assistiu por conta própria. Abra um pôster para ler as avaliações ou deixar a sua.
      </p>
      <form className="wf-seen__search" role="search" action="/assistidos" method="get">
        {filter.tipo ? <input type="hidden" name="tipo" value={filter.tipo} /> : null}
        <div className="wf-searchbar">
          <label className="sr-only" htmlFor="busca-assistidos">
            Buscar nos assistidos
          </label>
          <input
            id="busca-assistidos"
            className="wf-searchbar__input"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar…"
            maxLength={SEARCH_MAX}
            autoComplete="off"
            enterKeyHint="search"
          />
          <button type="submit" className="wf-searchbar__go">
            <IconSearch />
            <span className="sr-only">Buscar</span>
          </button>
        </div>
        {searching ? (
          <Link href={hrefFor(filter.tipo, '')} className="wf-btn wf-btn--ghost wf-btn--sm">
            Limpar
          </Link>
        ) : null}
      </form>
      <nav className="wf-seg wf-seen__filter" aria-label="Filtrar por tipo">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={hrefFor(f.tipo, searching ? q : '')}
            className={f === filter ? 'is-on' : ''}
            aria-current={f === filter ? 'page' : undefined}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {searching ? (
        <p className="wf-seen__count" role="status">
          {items.length
            ? `${items.length} ${items.length === 1 ? 'resultado' : 'resultados'} para “${q}”.`
            : `Nenhum título assistido encontrado para “${q}”.`}
        </p>
      ) : null}
      {items.length ? null : searching ? (
        <p className="wf-seen__intro">
          Confira a grafia ou{' '}
          <Link href={hrefFor(filter.tipo, '')} className="underline">
            limpe a busca
          </Link>
          .
        </p>
      ) : (
        <p className="wf-seen__intro">
          {filter.kind ? 'Nada deste tipo foi assistido ainda.' : 'Nada foi assistido ainda.'}{' '}
          <Link href="/" className="underline">
            Patrocine um filme
          </Link>{' '}
          para ele entrar na próxima live.
        </p>
      )}
      {items.length ? (
        <ul className="wf-fame" aria-label="Parede de pôsteres dos títulos assistidos">
          {items.map((it) => (
            <li key={it.id}>
              <Link
                href={`/${KIND_PATH[it.kind]}/${it.slug}`}
                className="wf-seen__card wf-fame__tile"
                prefetch={false}
                data-tilt="6"
              >
                <span className="wf-seen__poster wf-fame__poster" aria-hidden="true">
                  {it.poster ? (
                    <MediaPicture
                      picture={it.poster}
                      alt=""
                      sizes="(max-width: 480px) 33vw, (max-width: 1280px) 15vw, 180px"
                    />
                  ) : (
                    <span className="wf-fame__noposter">{it.title}</span>
                  )}
                </span>
                <span className="wf-fame__cap">
                  <span className="wf-seen__title">{it.title}</span>
                  <span className="wf-seen__meta">
                    {KIND_PT[it.kind]}
                    {it.year ? ` · ${it.year}` : ''}
                  </span>
                  <span className="wf-seen__meta">
                    Assistido em{' '}
                    <time dateTime={it.watchedAt}>{date.format(new Date(it.watchedAt))}</time>
                  </span>
                  {it.offStream ? <span className="wf-seen__off">Fora da live</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
