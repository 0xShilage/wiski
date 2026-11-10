import type { Metadata } from 'next';
import { MediaPicture } from '@/components/media/MediaPicture';
import { GAME_STATUS_PT, listGames } from '@/server/games/games';

export const metadata: Metadata = {
  title: 'Jogos',
  description: 'Os jogos que passaram na live do Wiski.',
};

const day = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC', // a calendar day
});

/**
 * /jogos (2026-11-09): the games played on stream — only a showcase, nothing to sponsor. What is
 * being played first, then the finished ones, then the dropped ones. A VOD link opens on Twitch
 * or YouTube in a new tab.
 */
export default async function JogosPage() {
  const games = await listGames();
  return (
    <div className="wf-page wf-seen">
      <h1 className="wf-h1">Jogos</h1>
      <p className="wf-seen__intro">
        Os jogos que já passaram (ou estão passando) na live. Aqui é só vitrine: não tem patrocínio.
      </p>
      {games.length ? (
        <ul className="wf-seen__grid wf-games">
          {games.map((g) => (
            <li key={g.id} className="wf-seen__card">
              <span className="wf-seen__poster" aria-hidden="true">
                {g.cover ? (
                  <MediaPicture picture={g.cover} alt="" sizes="(max-width: 760px) 45vw, 200px" />
                ) : null}
                <span className={`wf-games__status wf-games__status--${g.status.toLowerCase()}`}>
                  {GAME_STATUS_PT[g.status]}
                </span>
              </span>
              <span className="wf-seen__title">{g.title}</span>
              <span className="wf-seen__meta">
                {[g.platform, g.year].filter(Boolean).join(' · ') || ' '}
              </span>
              {g.finishedOn ? (
                <span className="wf-seen__meta">
                  {g.status === 'FINISHED' ? 'Zerado em' : 'Dropado em'}{' '}
                  <time dateTime={g.finishedOn}>
                    {day.format(new Date(`${g.finishedOn}T00:00:00.000Z`))}
                  </time>
                </span>
              ) : null}
              {g.note ? <span className="wf-seen__meta">“{g.note}”</span> : null}
              {g.vodUrl ? (
                <a
                  className="wf-games__vod"
                  href={g.vodUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Assistir o VOD<span className="sr-only"> de {g.title} (abre em nova aba)</span>
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="wf-seen__intro">Nenhum jogo por aqui ainda.</p>
      )}
    </div>
  );
}
