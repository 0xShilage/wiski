import type { Trail } from '@/lib/trail';

const day = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

const STATE_PT = { done: 'feito', next: 'próxima parada', todo: 'ainda não' } as const;

/**
 * Trilha da maratona (2026-11-13): a series, anime or franchise in progress as a board-game route
 * — the parts already shown on stream filled in, the next one pulsing, "você está aqui" on the last
 * one the live reached, and the finish line. A plain ordered list for screen readers.
 */
export function MarathonTrail({ trail }: { trail: Trail }) {
  return (
    <section className="wf-trail" aria-labelledby="trilha">
      <h2 className="wf-h2" id="trilha">
        Trilha da maratona
      </h2>
      <p className="wf-trail__summary">{trail.summary}</p>
      <div className="wf-trail__scroll">
        <ol className={`wf-trail__route${trail.complete ? ' is-complete' : ''}`}>
          {trail.stops.map((s, i) => (
            <li
              key={`${i}:${s.label}`}
              className={`wf-trail__stop is-${s.state}`}
              aria-current={s.state === 'next' ? 'step' : undefined}
            >
              <span className="wf-trail__dot" aria-hidden="true">
                {s.state === 'done' ? '✓' : s.label === 'Fim' ? '🏁' : i + 1}
              </span>
              <span className="wf-trail__name">{s.title}</span>
              <span className="sr-only"> ({STATE_PT[s.state]})</span>
              {s.here ? (
                <span className="wf-trail__here">
                  Você está aqui{s.at ? ` · ${day.format(new Date(s.at))}` : ''}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
