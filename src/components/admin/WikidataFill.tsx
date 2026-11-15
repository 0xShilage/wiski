'use client';
import { useId, useState } from 'react';
import { adminFetch } from '@/lib/passkey-client';
import type { Kind } from './types';

export type WikiCandidate = {
  id: string;
  title: string;
  description: string | null;
  year: number | null;
};
export type WikiFill = {
  id: string;
  url: string;
  fields: {
    title: string;
    originalTitle: string | null;
    year: number | null;
    runtimeMinutes: number | null;
    ageRating: string | null;
    genres: string[];
    director: string | null;
    cast: string[];
    trailer: string | null;
    seasonCount: number | null;
    episodeCount: number | null;
    seasonsLabel: string | null;
    franchiseEntries: { title: string; year: number | null; runtimeMinutes: number | null }[];
  };
  summary: { text: string; url: string } | null;
};

const WHAT: Record<Kind, string> = {
  MOVIE: 'filme',
  SERIES: 'série',
  ANIME: 'anime',
  FRANCHISE: 'franquia',
};

/**
 * "Preencher com o Wikidata" (2026-11-15): search a title, pick the right one, and the editor
 * fills title, original title, year, runtime, rating, genres, director, cast and trailer. The
 * images and the synopsis stay with Iara (the Wikipedia summary appears as a reference).
 */
export function WikidataFill({
  kind,
  initialQuery,
  filledId,
  onFill,
  onUndo,
}: {
  kind: Kind;
  initialQuery: string;
  /** the item the form was filled from in this session (shows "Desfazer") */
  filledId: string | null;
  onFill: (fill: WikiFill) => void;
  onUndo: (() => void) | null;
}) {
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<WikiCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const q = query.trim();
    if (!q) return;
    setBusy('search');
    setError(null);
    const r = await adminFetch<{ results: WikiCandidate[] }>(
      `/api/v1/admin/catalog/lookup?${new URLSearchParams({ kind, q })}`,
    );
    setBusy(null);
    if (!r.ok) {
      setError(r.problem.detail);
      return;
    }
    setResults(r.data.results);
  }

  async function pick(c: WikiCandidate) {
    setBusy(c.id);
    setError(null);
    const r = await adminFetch<{ fill: WikiFill }>(
      `/api/v1/admin/catalog/lookup?${new URLSearchParams({ kind, id: c.id })}`,
    );
    setBusy(null);
    if (!r.ok) {
      setError(r.problem.detail);
      return;
    }
    setResults(null);
    onFill(r.data.fill);
  }

  return (
    <section className="wf-wd" aria-labelledby={`${id}-h`}>
      <div className="wf-wd__head">
        <h3 id={`${id}-h`}>Preencher com o Wikidata</h3>
        <span className="wf-hint">
          Título, ano, duração, classificação, gêneros, direção, elenco e trailer. Imagens e sinopse
          ficam com você.
        </span>
      </div>
      <form
        className="wf-wd__search"
        role="search"
        aria-label="Buscar no Wikidata"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          className="wf-input"
          aria-label={`Nome do ${WHAT[kind]}`}
          placeholder={`Nome do ${WHAT[kind]} (em português ou no original)`}
          value={query}
          maxLength={200}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="wf-btn wf-btn--ghost" disabled={!!busy || !query.trim()}>
          {busy === 'search' ? 'Buscando…' : 'Buscar'}
        </button>
      </form>
      {error ? (
        <p role="alert" className="wf-hint wf-hint--err m-0">
          {error}
        </p>
      ) : null}
      {results ? (
        results.length ? (
          <ul className="wf-wd__results" aria-label="Resultados do Wikidata">
            {results.map((c) => (
              <li key={c.id}>
                <button type="button" disabled={!!busy} onClick={() => void pick(c)}>
                  <span className="wf-wd__title">
                    {c.title}
                    {c.year ? <span className="wf-wd__year"> {c.year}</span> : null}
                  </span>
                  {c.description ? <span className="wf-wd__desc">{c.description}</span> : null}
                  <span className="wf-wd__use" aria-hidden="true">
                    {busy === c.id ? 'Preenchendo…' : 'Usar'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wf-hint m-0" role="status">
            Nada encontrado como {WHAT[kind]}. Tente o título original ou outra grafia.
          </p>
        )
      ) : null}
      {filledId ? (
        <p className="wf-hint m-0" role="status">
          Preenchido com o Wikidata ·{' '}
          <a
            className="wf-linkbtn"
            href={`https://www.wikidata.org/wiki/${filledId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            ver {filledId}
          </a>
          {onUndo ? (
            <>
              {' · '}
              <button type="button" className="wf-linkbtn" onClick={onUndo}>
                Desfazer
              </button>
            </>
          ) : null}
          . Confira e salve.
        </p>
      ) : null}
    </section>
  );
}
