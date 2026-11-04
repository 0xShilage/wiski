import Link from 'next/link';
import type { TitleQueueStatus } from '@/lib/queue-position';
import { Countdown } from './Countdown';

const when = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
const time = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/**
 * "Na fila" on a title page (2026-11-04): playing now, booked on a live (its place that night and
 * a rough start time, with a countdown), or paid and waiting for a date (its place in the queue).
 */
export function QueueCard({ status }: { status: TitleQueueStatus }) {
  if (status.kind === 'playing') {
    return (
      <div className="wf-panel wf-queue-card is-playing" aria-labelledby="fila-titulo">
        <h2 id="fila-titulo">Passando agora na live</h2>
        <p className="wf-muted">Corre para a Twitch: este título está na tela neste momento.</p>
      </div>
    );
  }
  if (status.kind === 'scheduled') {
    const est = status.estimatedAt ? new Date(status.estimatedAt) : null;
    return (
      <div className="wf-panel wf-queue-card" aria-labelledby="fila-titulo">
        <h2 id="fila-titulo">{status.live ? 'Na live de agora' : 'Agendado'}</h2>
        <p className="wf-queue-card__pos">
          <strong>{status.position}º</strong>
          <span>
            de {status.total} {status.total === 1 ? 'título' : 'títulos'}{' '}
            {status.live ? 'que ainda vão passar hoje' : 'da live'}
          </span>
        </p>
        {status.live ? null : (
          <p className="wf-muted">
            Live de {when.format(new Date(status.sessionStartsAt))}
            {status.position === 1
              ? '; é o primeiro da noite'
              : est
                ? `; deve começar por volta das ${time.format(est)}`
                : ''}
            .
          </p>
        )}
        {est ? <Countdown to={est.toISOString()} prefix="Começa" /> : null}
        <p className="wf-queue-card__fine">
          Horário aproximado: soma a duração dos títulos antes dele.{' '}
          <Link href="/cronograma">Ver o cronograma</Link>
        </p>
      </div>
    );
  }
  return (
    <div className="wf-panel wf-queue-card" aria-labelledby="fila-titulo">
      <h2 id="fila-titulo">Na fila</h2>
      <p className="wf-queue-card__pos">
        <strong>{status.position}º</strong>
        <span>
          de {status.total} {status.total === 1 ? 'título' : 'títulos'} esperando uma data
        </span>
      </p>
      {status.nextLiveAt ? (
        <>
          <p className="wf-muted">
            Próxima live: {when.format(new Date(status.nextLiveAt))}. A ordem segue o pagamento (e
            quem pagou para furar a fila vai antes).
          </p>
          <Countdown to={status.nextLiveAt} prefix="Próxima live" />
        </>
      ) : (
        <p className="wf-muted">
          A próxima live ainda não foi marcada. A ordem segue o pagamento (e quem pagou para furar a
          fila vai antes).
        </p>
      )}
      <p className="wf-queue-card__fine">
        <Link href="/cronograma">Ver o cronograma</Link>
      </p>
    </div>
  );
}
