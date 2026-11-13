import type { Trail } from '@/lib/trail';

const day = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

const STATE_PT = { done: 'assistida', next: 'próxima parada', todo: 'ainda não' } as const;

/**
 * Trilha da maratona (2026-11-13): a series, anime or franchise in progress as a board-game route
 * — one stop per season or film, the watched ones filled in, the next one pulsing, and "você está
 * aqui" on the last stop the live reached. A plain ordered list for screen readers.
 */
export function MarathonTrail({ trail }: { trail: Trail }) {
  const { stops, done, total, complete, unit } = trail;
  const fem = unit.one === 'temporada';
  const summary = complete
    ? `Maratona concluída: ${total} ${unit.many}.`
    : `${done} de ${total} ${unit.many} ${fem ? 'assistidas' : 'assistidos'}.`;
  return (
    <section className="wf-trail" aria-labelledby="trilha">
      <h2 className="wf-h2" id="trilha">
        Trilha da maratona
      </h2>
      <p className="wf-trail__summary">{summary}</p>
      <div className="wf-trail__scroll">
        <ol className={`wf-trail__route${complete ? ' is-complete' : ''}`}>
          {stops.map((s, i) => (
            <li
              key={s.label}
              className={`wf-trail__stop is-${s.state}`}
              aria-current={s.state === 'next' ? 'step' : undefined}
            >
              <span className="wf-trail__dot" aria-hidden="true">
                {s.state === 'done' ? '✓' : s.label}
              </span>
              <span className="wf-trail__name">{s.title}</span>
              <span className="sr-only">
                {' '}
                ({s.state === 'done' && !fem ? 'assistido' : STATE_PT[s.state]})
              </span>
              {!complete && i === done - 1 ? (
                <span className="wf-trail__here">
                  Você está aqui
                  {trail.since ? ` · ${day.format(new Date(trail.since))}` : ''}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
