'use client';
import { useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import type { ReviewPage, ReviewSort } from '@/lib/reviews/types';
import { ReviewCard, type Viewer } from './ReviewCard';

export type ReviewSource =
  { kind: 'item'; itemId: string } | { kind: 'latest' } | { kind: 'user'; username: string };

function endpoint(source: ReviewSource, sort: ReviewSort, cursor: string | null): string {
  const q = new URLSearchParams();
  if (source.kind === 'item') q.set('sort', sort);
  if (cursor) q.set('cursor', cursor);
  const qs = q.toString() ? `?${q}` : '';
  if (source.kind === 'item') return `/api/v1/items/${source.itemId}/reviews${qs}`;
  if (source.kind === 'user') return `/api/v1/users/${source.username}/reviews${qs}`;
  return `/api/v1/reviews${qs}`;
}

/** A list of reviews with "Mais recentes / Mais curtidas" (item pages) and "Carregar mais". */
export function ReviewList({
  initial,
  source,
  viewer,
  showItem = false,
  showAuthor = true,
  empty,
}: {
  initial: ReviewPage;
  source: ReviewSource;
  viewer: Viewer;
  showItem?: boolean;
  showAuthor?: boolean;
  empty: string;
}) {
  const [sort, setSort] = useState<ReviewSort>('recent');
  const [reviews, setReviews] = useState(initial.reviews);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(nextSort: ReviewSort, from: string | null) {
    setBusy(true);
    setError(null);
    const r = await apiFetch<ReviewPage>(endpoint(source, nextSort, from));
    setBusy(false);
    if (!r.ok) {
      setError(r.problem.detail);
      return;
    }
    // on a title page the viewer's own review is shown separately, above the list
    const fresh = source.kind === 'item' ? r.data.reviews.filter((x) => !x.mine) : r.data.reviews;
    setReviews((prev) => (from ? [...prev, ...fresh] : fresh));
    setCursor(r.data.nextCursor);
  }

  function changeSort(next: ReviewSort) {
    if (next === sort || busy) return;
    setSort(next);
    void load(next, null);
  }

  return (
    <div className="wf-reviews">
      {source.kind === 'item' && reviews.length > 1 ? (
        <div className="wf-seg" role="group" aria-label="Ordenar avaliações">
          {(
            [
              ['recent', 'Mais recentes'],
              ['top', 'Mais curtidas'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={sort === value ? 'is-on' : ''}
              aria-pressed={sort === value}
              onClick={() => changeSort(value)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {reviews.length ? (
        <ul className="wf-reviews__list" aria-busy={busy}>
          {reviews.map((r) => (
            <li key={r.id}>
              <ReviewCard review={r} viewer={viewer} showItem={showItem} showAuthor={showAuthor} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="wf-muted">{empty}</p>
      )}

      {error ? (
        <p className="wf-hint wf-hint--err" role="alert">
          {error}
        </p>
      ) : null}
      {cursor ? (
        <button
          type="button"
          className="wf-btn wf-btn--ghost wf-reviews__more"
          onClick={() => void load(sort, cursor)}
          disabled={busy}
        >
          {busy ? 'Carregando…' : 'Carregar mais'}
        </button>
      ) : null}
    </div>
  );
}
