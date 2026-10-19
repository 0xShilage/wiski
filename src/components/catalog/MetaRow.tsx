import type { AgeRatingCode } from '@/lib/catalog/age-rating';
import { formatRuntime } from '@/lib/catalog/pricing';
import { AgeBadge } from './AgeBadge';

/** "14 • 2021 │ 1 h 55 min │ Ficção científica" (design §2 meta row). */
export function MetaRow({
  ageRating,
  year,
  runtimeMinutes,
  genres,
  extra,
  className,
}: {
  ageRating: AgeRatingCode | null;
  year: number | null;
  runtimeMinutes?: number | null;
  genres: string[];
  extra?: string | null;
  className?: string;
}) {
  const parts = [
    year ? String(year) : null,
    runtimeMinutes ? formatRuntime(runtimeMinutes) : null,
    extra ?? null,
    genres.length ? genres.slice(0, 2).join(', ') : null,
  ].filter((p): p is string => !!p);
  return (
    <p className={`wf-meta ${className ?? ''}`}>
      <AgeBadge rating={ageRating} />
      {ageRating && parts.length ? <span className="wf-meta__dot" aria-hidden="true" /> : null}
      {parts.map((p) => (
        <span key={p} className="wf-meta__item">
          {p}
        </span>
      ))}
    </p>
  );
}
