import { AGE_DESCRIPTION, AGE_LABEL, type AgeRatingCode } from '@/lib/catalog/age-rating';

/** Classificação indicativa badge (official colours, readable text). */
export function AgeBadge({ rating }: { rating: AgeRatingCode | null }) {
  if (!rating) return null;
  return (
    <span className={`wf-age wf-age--${rating}`} title={AGE_DESCRIPTION[rating]}>
      <span aria-hidden="true">{AGE_LABEL[rating]}</span>
      <span className="sr-only">{AGE_DESCRIPTION[rating]}</span>
    </span>
  );
}
