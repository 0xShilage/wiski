import Link from 'next/link';
import { KIND_PATH } from '@/lib/catalog/kinds';
import type { PublicSession } from '@/server/live/public';

const when = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** "Próximos na live" (11 §3, O7): the next sessions and what is booked in them. */
export function UpNext({ sessions }: { sessions: PublicSession[] }) {
  if (!sessions.length) return null;
  return (
    <section className="wf-upnext" aria-labelledby="proximos-na-live">
      <h2 id="proximos-na-live" className="wf-h2">
        Próximos na live
      </h2>
      <ul className="wf-upnext__list">
        {sessions.map((s) => (
          <li key={s.id} className={s.live ? 'wf-upnext__card is-live' : 'wf-upnext__card'}>
            <span className="wf-upnext__when">
              {s.live ? 'Ao vivo agora' : when.format(new Date(s.startsAt))}
            </span>
            {s.note ? <span className="text-sm text-fg-muted">{s.note}</span> : null}
            {s.titles.length ? (
              <ul className="wf-upnext__titles">
                {s.titles.map((t, n) => {
                  const mark = t.done ? '✓ ' : t.playing ? '▶ ' : '';
                  const name = t.part ? `${t.title} · ${t.part}` : t.title;
                  return (
                    <li key={`${n}:${t.kind}:${t.slug ?? t.title}`}>
                      {t.slug ? (
                        <Link href={`/${KIND_PATH[t.kind as keyof typeof KIND_PATH]}/${t.slug}`}>
                          {mark}
                          {name}
                        </Link>
                      ) : (
                        <span>
                          {mark}
                          {name}
                        </span>
                      )}
                      <span className="text-xs text-fg-muted">
                        {t.kind === 'MOVIE'
                          ? ` · ${t.sponsor ?? 'Anônimo'}`
                          : t.note
                            ? ` · ${t.note}`
                            : ''}
                        {t.jumped ? ' · furou a fila' : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <span className="text-sm text-fg-muted">
                Ainda sem filmes. Patrocine um para ele entrar aqui.
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
