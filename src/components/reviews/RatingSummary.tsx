import { formatAverage, type RatingSummary as Summary } from '@/lib/reviews/types';
import { Stars } from './Stars';

/** Average, count and the 5→1 distribution (<progress> bars: no inline widths under the CSP). */
export function RatingSummary({ summary }: { summary: Summary }) {
  if (!summary.count || summary.average10 === null) return null;
  const rounded = Math.round(summary.average10 / 10);
  return (
    <div className="wf-rsum">
      <div className="wf-rsum__avg">
        <p className="wf-rsum__num">{formatAverage(summary.average10)}</p>
        <Stars rating={rounded} size="sm" />
        <p className="wf-muted text-xs">
          {summary.count} {summary.count === 1 ? 'avaliação' : 'avaliações'}
        </p>
      </div>
      <ul className="wf-rsum__bars" aria-label="Distribuição das notas">
        {[5, 4, 3, 2, 1].map((n) => {
          const c = summary.distribution[n - 1]!;
          return (
            <li key={n}>
              <span aria-hidden="true">{n}★</span>
              <progress
                className="wf-progress wf-progress--sm"
                max={summary.count}
                value={c}
                aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}: ${c}`}
              />
              <span className="wf-muted text-xs" aria-hidden="true">
                {c}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
