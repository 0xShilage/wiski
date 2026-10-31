import type { Metadata } from 'next';
import Link from 'next/link';
import { KIND_PATH } from '@/lib/catalog/kinds';
import { cronograma } from '@/server/live/public';

export const metadata: Metadata = {
  title: 'Cronograma',
  description: 'Os filmes, séries e franquias já marcados nas próximas lives do Wiski.',
};

const KIND_PT = { MOVIE: 'Filme', SERIES: 'Série', FRANCHISE: 'Franquia' } as const;
const dayFmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC', // the key is already the São Paulo calendar day
});
const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/**
 * /cronograma (2026-10-31): every title already placed on an upcoming live, by day, and what was
 * watched in the last two days. Titles paid for but not yet given a date are not listed.
 */
export default async function CronogramaPage() {
  const days = await cronograma();
  return (
    <div className="wf-page wf-cron">
      <h1 className="wf-h1">Cronograma</h1>
      <p className="wf-cron__intro">
        O que já está marcado nas próximas lives. Horários de Brasília. Patrocinou um filme e ele
        ainda não aparece? Ele entra aqui assim que a moderação escolher a sessão.
      </p>
      {days.length === 0 ? (
        <p className="wf-cron__empty">
          Nenhuma live marcada por enquanto.{' '}
          <Link href="/" className="underline">
            Patrocine um filme
          </Link>{' '}
          para ele entrar na próxima.
        </p>
      ) : (
        days.map((d) => (
          <section key={d.date} className="wf-cron__day" aria-labelledby={`dia-${d.date}`}>
            <h2 id={`dia-${d.date}`} className="wf-cron__date">
              {dayFmt.format(new Date(`${d.date}T12:00:00Z`))}
            </h2>
            {d.sessions.map((s) => (
              <article
                key={s.id}
                className={
                  s.live
                    ? 'wf-cron__session is-live'
                    : s.past
                      ? 'wf-cron__session is-past'
                      : 'wf-cron__session'
                }
                aria-label={`Live das ${timeFmt.format(new Date(s.startsAt))}`}
              >
                <header className="wf-cron__head">
                  <span className="wf-cron__time">{timeFmt.format(new Date(s.startsAt))}</span>
                  {s.live ? (
                    <span className="wf-pill wf-pill--ok">Ao vivo agora</span>
                  ) : s.past ? (
                    <span className="wf-pill">Já foi</span>
                  ) : null}
                  {s.note ? <span className="wf-cron__note">{s.note}</span> : null}
                </header>
                {s.titles.length ? (
                  <ol className="wf-cron__titles">
                    {s.titles.map((t) => (
                      <li key={`${t.kind}:${t.slug}`}>
                        <Link href={`/${KIND_PATH[t.kind]}/${t.slug}`} className="wf-cron__title">
                          {t.title}
                        </Link>
                        <span className="wf-cron__meta">
                          {KIND_PT[t.kind]}
                          {t.kind === 'MOVIE' ? ` · ${t.sponsor ?? 'Anônimo'}` : ''}
                          {t.jumped && !s.past ? ' · furou a fila' : ''}
                        </span>
                        {s.now === t.title && s.live ? (
                          <span className="wf-pill wf-pill--ok">Passando agora</span>
                        ) : t.done ? (
                          <span className="wf-pill">Assistido</span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="wf-cron__meta">Ainda sem títulos nesta live.</p>
                )}
              </article>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
