import { IconStar } from '@/components/ui/icons';

/** 1–5 whole stars (Q15), read-only. The number is in the accessible name, not in the drawing. */
export function Stars({ rating, size = 'md' }: { rating: number; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={`wf-stars wf-stars--${size}`}
      role="img"
      aria-label={`${rating} de 5 estrelas`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <IconStar key={n} className={n <= rating ? 'wf-star is-on' : 'wf-star'} />
      ))}
    </span>
  );
}
