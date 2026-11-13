import type { PublicReview } from '@/lib/reviews/types';
import { clippingExcerpt } from '@/lib/reviews/clipping';

const longDate = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

/**
 * Críticas como recortes de jornal (2026-11-13): the title's most-liked review as a newspaper
 * clipping — the "Gazeta Wiski" masthead, the stars, the review in a serif face, the byline —
 * pinned slightly crooked above the list. The full review is still in the list below.
 */
export function ReviewClipping({ review }: { review: PublicReview }) {
  const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
  return (
    <figure className="wf-clipping" aria-labelledby="recorte-h">
      <div className="wf-clipping__paper">
        <p className="wf-clipping__mast">
          <span>Gazeta Wiski</span>
          <span>{longDate.format(new Date(review.createdAt))}</span>
        </p>
        <h3 className="wf-clipping__kicker" id="recorte-h">
          A crítica mais curtida
        </h3>
        <p className="wf-clipping__stars">
          <span aria-hidden="true">{stars}</span>
          <span className="sr-only">{review.rating} de 5 estrelas</span>
        </p>
        <blockquote className="wf-clipping__body">
          <p>“{clippingExcerpt(review.body)}”</p>
        </blockquote>
        <figcaption className="wf-clipping__byline">
          — @{review.author.username} ·{' '}
          {review.likeCount === 1 ? '1 curtida' : `${review.likeCount} curtidas`}
        </figcaption>
      </div>
    </figure>
  );
}
