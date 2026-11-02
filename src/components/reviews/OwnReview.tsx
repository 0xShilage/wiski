'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import type { OwnReview as Own } from '@/lib/reviews/types';
import { reviewDate } from './format';
import { ReviewForm } from './ReviewForm';
import { Stars } from './Stars';

const NOTICE: Record<Exclude<Own['status'], 'VISIBLE'>, string> = {
  AUTO_HIDDEN: '',
  HIDDEN:
    'A moderação ocultou esta avaliação: só você a vê. Se achar que foi engano, fale com a gente pela página de contato.',
  REMOVED:
    'Esta avaliação foi removida por violar as regras da comunidade. Só você a vê, e não é possível publicar outra para este título.',
};

function notice(r: Own): string | null {
  if (r.status === 'VISIBLE') return null;
  if (r.status === 'AUTO_HIDDEN') {
    return r.heldReason === 'LINKS'
      ? 'Sua avaliação tem mais de 2 links e está aguardando a moderação. Por enquanto só você a vê.'
      : 'Algumas pessoas denunciaram esta avaliação. Ela fica escondida até a moderação revisar.';
  }
  return NOTICE[r.status];
}

/** The viewer's own review on this title, whatever the moderation did with it. */
export function OwnReview({
  review,
  itemId,
  siteKey,
}: {
  review: Own;
  itemId: string;
  siteKey: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const msg = notice(review);

  async function remove() {
    if (!window.confirm('Excluir sua avaliação? Curtidas e denúncias somem junto.')) return;
    setBusy(true);
    setError(null);
    const r = await apiFetch(`/api/v1/reviews/${review.id}`, { method: 'DELETE' });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.problem.detail);
  }

  if (editing) {
    return (
      <div className="wf-panel">
        <h3 className="wf-reviews__h3">Editar sua avaliação</h3>
        <ReviewForm
          itemId={itemId}
          siteKey={siteKey}
          editing={review}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="wf-panel wf-own">
      <h3 className="wf-reviews__h3">Sua avaliação</h3>
      {msg ? (
        <p className="wf-notice" role="status">
          {msg}
        </p>
      ) : null}
      <div className="wf-review__meta">
        <Stars rating={review.rating} />
        <span className="wf-muted text-xs">
          {reviewDate(review.createdAt)}
          {review.editedAt ? ' · editado' : ''}
          {review.containsSpoilers ? ' · com spoiler' : ''}
          {review.status === 'VISIBLE'
            ? ` · ${review.likeCount} ${review.likeCount === 1 ? 'curtida' : 'curtidas'}`
            : ''}
        </span>
      </div>
      <p className="wf-review__body">{review.body}</p>
      {error ? (
        <p className="wf-hint wf-hint--err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="wf-co__row">
        {review.status === 'VISIBLE' ? (
          <button
            type="button"
            className="wf-btn wf-btn--ghost wf-btn--sm"
            onClick={() => setEditing(true)}
          >
            Editar
          </button>
        ) : null}
        {review.status !== 'REMOVED' ? (
          <button
            type="button"
            className="wf-linkbtn text-sm"
            onClick={() => void remove()}
            disabled={busy}
          >
            Excluir
          </button>
        ) : null}
      </div>
    </div>
  );
}
