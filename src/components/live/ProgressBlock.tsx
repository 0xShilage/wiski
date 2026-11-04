import Link from 'next/link';
import type { PerKind, WatchProgress } from '@/server/catalog/progress';

const num = new Intl.NumberFormat('pt-BR');

/** 9 125 minutes → "152 h 5 min"; under an hour → "45 min". */
export function hoursMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${num.format(h)} h ${m} min` : `${num.format(h)} h`;
}

function split(by: PerKind, fmt: (n: number) => string) {
  return [
    ['Filmes', by.MOVIE],
    ['Séries', by.SERIES],
    ['Franquias', by.FRANCHISE],
  ].map(([label, n]) => (
    <li key={label as string}>
      <span>{label}</span> <strong>{fmt(n as number)}</strong>
    </li>
  ));
}

/**
 * "Nosso progresso" (Phase 6), at the bottom of the home page: what was watched on stream, how
 * long it runs in total and what is paid or funded but still waiting — each with a per-kind split.
 */
export function ProgressBlock({ progress }: { progress: WatchProgress }) {
  const tiles = [
    {
      id: 'assistidos',
      label: 'Títulos assistidos',
      value: num.format(progress.watched.total),
      by: progress.watched.byKind,
      fmt: (n: number) => num.format(n),
    },
    {
      id: 'tempo',
      label: 'Tempo assistido',
      value: hoursMinutes(progress.minutes.total),
      by: progress.minutes.byKind,
      fmt: hoursMinutes,
    },
    {
      id: 'fila',
      label: 'Na fila',
      value: num.format(progress.queued.total),
      by: progress.queued.byKind,
      fmt: (n: number) => num.format(n),
    },
  ];
  return (
    <section className="wf-progress-block" aria-labelledby="nosso-progresso">
      <h2 id="nosso-progresso" className="wf-h2">
        Nosso progresso
      </h2>
      <div className="wf-progress-block__grid">
        {tiles.map((t) => (
          <article key={t.id} className="wf-progress-block__tile" aria-labelledby={`pb-${t.id}`}>
            <h3 id={`pb-${t.id}`} className="wf-progress-block__label">
              {t.label}
            </h3>
            <p className="wf-progress-block__value">{t.value}</p>
            <ul className="wf-progress-block__split" aria-label={`${t.label} por tipo`}>
              {split(t.by, t.fmt)}
            </ul>
          </article>
        ))}
      </div>
      <p className="wf-progress-block__foot">
        O tempo soma a duração de cada título assistido na live. Na fila: filmes pagos e séries ou
        franquias com a meta batida que ainda vão passar.{' '}
        <Link href="/ranking" className="underline underline-offset-4">
          Ver o ranking da comunidade
        </Link>
        .
      </p>
    </section>
  );
}
