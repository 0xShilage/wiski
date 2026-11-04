'use client';
import { useEffect, useId, useState } from 'react';
import { IconSearch } from '@/components/ui/icons';
import {
  type CatalogFilter,
  type CatalogSort,
  type Duration,
  DURATIONS,
  EMPTY_FILTER,
  filterQuery,
  isFiltering,
} from '@/lib/catalog/filter';

/** The filter state, mirrored in the address bar (replaceState: no reload, no history spam). */
export function useCatalogFilter(initial: CatalogFilter) {
  const [filter, setFilter] = useState(initial);
  useEffect(() => {
    const url = `${window.location.pathname}${filterQuery(filter)}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, [filter]);
  return [filter, setFilter] as const;
}

/**
 * Busca, gênero, duração (movies) and order (2026-11-04). Plain form controls; results update as
 * you type or pick, and the count is announced politely.
 */
export function CatalogFilterBar({
  filter,
  onChange,
  genres,
  sorts,
  showDuration,
  shown,
  total,
  noun,
}: {
  filter: CatalogFilter;
  onChange: (f: CatalogFilter) => void;
  genres: string[];
  sorts: { value: CatalogSort; label: string }[];
  showDuration: boolean;
  /** how many match, out of how many — shown only while a filter is on */
  shown: number;
  total: number;
  noun: [string, string];
}) {
  const id = useId();
  return (
    <form
      className="wf-filters"
      role="search"
      aria-label={`Filtrar ${noun[1]}`}
      onSubmit={(e) => e.preventDefault()}
    >
      <label className="wf-filters__search" htmlFor={`${id}-q`}>
        <span className="sr-only">Buscar por título, direção ou elenco</span>
        <IconSearch className="wf-filters__icon" />
        <input
          id={`${id}-q`}
          type="search"
          className="wf-filters__input"
          placeholder="Buscar…"
          maxLength={60}
          value={filter.q}
          onChange={(e) => onChange({ ...filter, q: e.target.value })}
        />
      </label>
      <label className="wf-filters__field" htmlFor={`${id}-g`}>
        <span className="sr-only">Gênero</span>
        <select
          id={`${id}-g`}
          className="wf-filters__select"
          value={filter.genero}
          onChange={(e) => onChange({ ...filter, genero: e.target.value })}
        >
          <option value="">Gênero</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      {showDuration ? (
        <label className="wf-filters__field" htmlFor={`${id}-d`}>
          <span className="sr-only">Duração</span>
          <select
            id={`${id}-d`}
            className="wf-filters__select"
            value={filter.duracao}
            onChange={(e) => onChange({ ...filter, duracao: e.target.value as Duration })}
          >
            {DURATIONS.map((d) => (
              <option key={d.value || 'any'} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="wf-filters__field" htmlFor={`${id}-o`}>
        <span className="sr-only">Ordenar por</span>
        <select
          id={`${id}-o`}
          className="wf-filters__select"
          value={filter.ordem}
          onChange={(e) => onChange({ ...filter, ordem: e.target.value as CatalogSort })}
        >
          {sorts.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <p className="wf-filters__count" aria-live="polite">
        {isFiltering(filter) ? `${shown} de ${total} ${total === 1 ? noun[0] : noun[1]}` : ''}
      </p>
      {isFiltering(filter) ? (
        <button
          type="button"
          className="wf-linkbtn wf-filters__clear"
          onClick={() => onChange(EMPTY_FILTER)}
        >
          Limpar filtros
        </button>
      ) : null}
    </form>
  );
}
