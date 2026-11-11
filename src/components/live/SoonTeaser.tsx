import Link from 'next/link';
import { MediaPicture } from '@/components/media/MediaPicture';
import { KIND_PATH } from '@/lib/catalog/kinds';
import type { CronogramaDay } from '@/server/live/public';
import { SoonCountdown } from './SoonCountdown';

const KIND_PT = {
  MOVIE: 'Filme',
  SERIES: 'Série',
  FRANCHISE: 'Franquia',
  ANIME: 'Anime',
  EVENT: 'Na live',
} as const;
const whenFmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

type Session = CronogramaDay['sessions'][number];

/** The next live that hasn't started: not past, not on air. Days and sessions come in order. */
export function nextLive(days: CronogramaDay[]): Session | null {
  for (const d of days) for (const s of d.sessions) if (!s.past && !s.live) return s;
  return null;
}

/**
 * "Em breve" (2026-11-11): the top of the Cronograma — the next live's titles as poster cards with
 * a ribbon, and a countdown to its start. Nothing when no live is planned. The full schedule below
 * still lists the same titles; this is the trailer for it.
 */
export function SoonTeaser({ session, now }: { session: Session; now: number }) {
  const titles = session.titles.filter((t) => !t.done);
  return (
    <section className="wf-soon" aria-labelledby="em-breve">
      <div className="wf-soon__head">
        <div>
          <p className="wf-soon__eyebrow">Próxima live</p>
          <h2 id="em-breve" className="wf-soon__title">
            Em breve
          </h2>
          <p className="wf-soon__when">
            <time dateTime={session.startsAt}>{whenFmt.format(new Date(session.startsAt))}</time>
            {session.note ? <span className="wf-soon__note">{session.note}</span> : null}
          </p>
        </div>
        <SoonCountdown target={session.startsAt} serverNow={now} />
      </div>
      {titles.length ? (
        <ul className="wf-soon__list">
          {titles.map((t, n) => {
            const href = t.slug
              ? `/${KIND_PATH[t.kind as keyof typeof KIND_PATH]}/${t.slug}`
              : null;
            const body = (
              <>
                <span className="wf-soon__poster" aria-hidden="true">
                  {t.poster ? (
                    <MediaPicture
                      picture={t.poster}
                      alt=""
                      sizes="(max-width: 760px) 45vw, 180px"
                    />
                  ) : (
                    <span className="wf-soon__noposter">{t.title}</span>
                  )}
                  <span className="wf-soon__ribbon">Em breve</span>
                </span>
                <span className="wf-soon__name">{t.title}</span>
                <span className="wf-soon__meta">
                  {t.part ? `${KIND_PT[t.kind]} · ${t.part}` : KIND_PT[t.kind]}
                </span>
              </>
            );
            return (
              <li key={`${n}:${t.kind}:${t.slug ?? t.title}`}>
                {href ? (
                  <Link href={href} className="wf-soon__card" prefetch={false} data-tilt="7">
                    {body}
                  </Link>
                ) : (
                  <div className="wf-soon__card">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="wf-soon__empty">Os títulos desta live ainda vão ser anunciados.</p>
      )}
    </section>
  );
}
