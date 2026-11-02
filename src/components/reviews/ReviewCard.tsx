'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { apiFetch } from '@/lib/api-fetch';
import { KIND_PATH } from '@/lib/catalog/kinds';
import type { PublicReview } from '@/lib/reviews/types';
import { reviewDate } from './format';
import { ReportDialog } from './ReportDialog';
import { Stars } from './Stars';

export type Viewer = { signedIn: boolean; loginHref: string };

/** Heart outline/filled — drawn here so the like state isn't carried by colour alone. */
function Heart({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={on ? 'wf-heart is-on' : 'wf-heart'}
    >
      <path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6.6 5 5 0 0 1 21.2 11C19 15.6 12 20 12 20z" />
    </svg>
  );
}

/**
 * One review (11 §2.3, Q15): author, stars, date, "editado", text (spoilers folded away), like
 * and report. Text is a React text node — never HTML. Links in it stay plain text.
 */
export function ReviewCard({
  review,
  viewer,
  showItem = false,
  showAuthor = true,
}: {
  review: PublicReview;
  viewer: Viewer;
  showItem?: boolean;
  showAuthor?: boolean;
}) {
  const [liked, setLiked] = useState(review.likedByMe ?? false);
  const [count, setCount] = useState(review.likeCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const mine = review.mine ?? false;

  async function toggleLike() {
    if (busy) return;
    const next = !liked;
    setBusy(true);
    setError(null);
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    const r = await apiFetch<{ liked: boolean; likeCount: number }>(
      `/api/v1/reviews/${review.id}/like`,
      { method: next ? 'PUT' : 'DELETE' },
    );
    setBusy(false);
    if (r.ok) {
      setLiked(r.data.liked);
      setCount(r.data.likeCount);
    } else {
      setLiked(!next);
      setCount((c) => c + (next ? -1 : 1));
      setError(r.problem.detail);
    }
  }

  const body = <p className="wf-review__body">{review.body}</p>;

  return (
    <article className="wf-review" aria-label={`Avaliação de @${review.author.username}`}>
      <header className="wf-review__head">
        {showAuthor ? (
          <Link href={`/u/${review.author.username}`} className="wf-review__author">
            <Avatar avatarKey={review.author.avatarKey} size={40} />
            <span>@{review.author.username}</span>
          </Link>
        ) : null}
        <div className="wf-review__meta">
          <Stars rating={review.rating} />
          <span className="wf-muted text-xs">
            {reviewDate(review.createdAt)}
            {review.editedAt ? ' · editado' : ''}
          </span>
        </div>
      </header>
      {showItem ? (
        <p className="wf-review__item">
          <Link href={`/${KIND_PATH[review.item.kind]}/${review.item.slug}`}>
            {review.item.title}
          </Link>
        </p>
      ) : null}

      {review.containsSpoilers ? (
        <details className="wf-review__spoiler">
          <summary>
            <span className="wf-chip">Contém spoiler</span> Mostrar texto
          </summary>
          {body}
        </details>
      ) : (
        body
      )}

      <footer className="wf-review__foot">
        {mine ? (
          <span className="wf-review__likes">
            <Heart on={false} /> {count} {count === 1 ? 'curtida' : 'curtidas'}
          </span>
        ) : viewer.signedIn ? (
          <button
            type="button"
            className="wf-review__like"
            aria-pressed={liked}
            onClick={() => void toggleLike()}
            disabled={busy}
          >
            <Heart on={liked} />
            <span>{count}</span>
            <span className="sr-only"> {liked ? 'Remover curtida' : 'Curtir'}</span>
          </button>
        ) : (
          <Link href={viewer.loginHref} className="wf-review__like">
            <Heart on={false} />
            <span>{count}</span>
            <span className="sr-only">
              {' '}
              {count === 1 ? 'curtida' : 'curtidas'} — entre para curtir
            </span>
          </Link>
        )}
        {viewer.signedIn && !mine ? (
          <button type="button" className="wf-linkbtn text-xs" onClick={() => setReporting(true)}>
            Denunciar
          </button>
        ) : null}
      </footer>
      {error ? (
        <p className="wf-hint wf-hint--err" role="alert">
          {error}
        </p>
      ) : null}
      {reporting ? (
        <ReportDialog
          reviewId={review.id}
          author={review.author.username}
          onClose={() => setReporting(false)}
        />
      ) : null}
    </article>
  );
}
