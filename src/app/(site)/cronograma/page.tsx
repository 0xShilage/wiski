import type { Metadata } from 'next';
import Link from 'next/link';
import { MediaPicture } from '@/components/media/MediaPicture';
import { KIND_PATH } from '@/lib/catalog/kinds';
import { cronograma } from '@/server/live/public';
import { publicReleases } from '@/server/releases/releases';

export const metadata: Metadata = {
  title: 'Cronograma',
  description:
    'Os filmes, séries e franquias já marcados nas próximas lives do Wiski, e as próximas temporadas.',
};

const KIND_PT = {
  MOVIE: 'Filme',
  SERIES: 'Série',
  FRANCHISE: 'Franquia',
  EVENT: 'Na live',
} as const;
const dayFmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC', // the key is already the São Paulo calendar day
});
const releaseFmt = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC', // a calendar day
});
const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/**
 * /cronograma (2026-10-31): every title already placed on an upcoming live, by day, and what was
 * watched in the last two days — episodes of a series, films of a franchise and custom events
 * included (2026-11-04). Titles paid for but not yet given a date are not listed.
 * Each title shows its poster (2026-11-01); "Próximas temporadas" sits beside the lives on wide
 * screens and below them on phones.
 */
export default async function CronogramaPage() {
  const [days, releases] = await Promise.all([cronograma(), publicReleases()]);
  return (
    <div className="wf-page wf-cron">
      <h1 className="wf-h1">Cronograma</h1>
      <p className="wf-cron__intro">
        O que já está marcado nas próximas lives. Horários de Brasília. Patrocinou um filme e ele
        ainda não aparece? Ele entra aqui assim que a moderação escolher a sessão.
      </p>
      <div className="wf-cron__layout">
        <div className="wf-cron__main">
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
                        {s.titles.map((t, n) => {
                          const href = t.slug
                            ? `/${KIND_PATH[t.kind as keyof typeof KIND_PATH]}/${t.slug}`
                            : null;
                          return (
                            <li key={`${n}:${t.kind}:${t.slug ?? t.title}`}>
                              {href ? (
                                <Link
                                  href={href}
                                  className="wf-cron__thumb"
                                  tabIndex={-1}
                                  aria-hidden="true"
                                >
                                  {t.poster ? (
                                    <MediaPicture picture={t.poster} alt="" sizes="56px" />
                                  ) : null}
                                </Link>
                              ) : (
                                <span
                                  className="wf-cron__thumb wf-cron__thumb--event"
                                  aria-hidden="true"
                                >
                                  {t.poster ? (
                                    <MediaPicture picture={t.poster} alt="" sizes="56px" />
                                  ) : (
                                    '★'
                                  )}
                                </span>
                              )}
                              <div className="wf-cron__info">
                                {href ? (
                                  <Link href={href} className="wf-cron__title">
                                    {t.title}
                                  </Link>
                                ) : (
                                  <span className="wf-cron__title">{t.title}</span>
                                )}
                                <span className="wf-cron__meta">
                                  {t.part ? `${KIND_PT[t.kind]} · ${t.part}` : KIND_PT[t.kind]}
                                  {t.kind === 'MOVIE' ? ` · ${t.sponsor ?? 'Anônimo'}` : ''}
                                  {t.jumped && !s.past ? ' · furou a fila' : ''}
                                  {t.note ? ` · ${t.note}` : ''}
                                </span>
                                {t.playing ? (
                                  <span className="wf-pill wf-pill--ok">Passando agora</span>
                                ) : t.done ? (
                                  <span className="wf-pill">
                                    {t.kind === 'EVENT' ? 'Rolou' : 'Assistido'}
                                  </span>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
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
        <aside className="wf-cron__aside" aria-labelledby="proximas-temporadas">
          <h2 id="proximas-temporadas" className="wf-cron__aside-title">
            Próximas temporadas
          </h2>
          {releases.length ? (
            <ul className="wf-rel">
              {releases.map((r) => {
                const body = (
                  <>
                    <span className="wf-rel__thumb" aria-hidden="true">
                      {r.poster ? <MediaPicture picture={r.poster} alt="" sizes="48px" /> : null}
                    </span>
                    <span className="wf-rel__info">
                      <span className="wf-rel__title">{r.title}</span>
                      <span className="wf-rel__season">{r.seasonLabel}</span>
                      <span className="wf-rel__meta">
                        {r.yearOnly ? (
                          <>
                            Previsão:{' '}
                            <time dateTime={r.releaseDate.slice(0, 4)}>
                              {r.releaseDate.slice(0, 4)}
                            </time>
                          </>
                        ) : (
                          <time dateTime={r.releaseDate}>
                            {releaseFmt.format(new Date(`${r.releaseDate}T12:00:00Z`))}
                          </time>
                        )}
                        {r.note ? ` · ${r.note}` : ''}
                      </span>
                    </span>
                    {r.released ? <span className="wf-pill wf-pill--ok">Estreou</span> : null}
                  </>
                );
                return (
                  <li key={r.id}>
                    {r.href ? (
                      <Link href={r.href} className="wf-rel__row">
                        {body}
                      </Link>
                    ) : (
                      <div className="wf-rel__row">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="wf-cron__meta">Nenhuma estreia anunciada por enquanto.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
