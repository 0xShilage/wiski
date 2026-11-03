'use client';
import { useState } from 'react';
import { IconPlay } from '@/components/ui/icons';
import { TWITCH_CHANNEL, TWITCH_URL, twitchPlayerUrl } from '@/lib/twitch';

/**
 * "Ao vivo agora" (2026-11-02), below "Nosso progresso" while a live is marked "Ao vivo" in
 * Cronograma. Like the trailers, the Twitch player is created only after the click: nothing loads
 * from Twitch before (no cookies, no IP sent to a third party just for opening the home page).
 */
export function TwitchLive({ parent }: { parent: string }) {
  const [on, setOn] = useState(false);
  return (
    <section className="wf-twitch" aria-labelledby="ao-vivo-agora">
      <h2 id="ao-vivo-agora" className="wf-h2">
        <span className="wf-twitch__dot" aria-hidden="true" />
        Ao vivo agora
      </h2>
      <div className="wf-twitch__frame">
        {on ? (
          <iframe
            src={twitchPlayerUrl(parent)}
            title={`Live de ${TWITCH_CHANNEL} na Twitch`}
            allow="autoplay; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button type="button" className="wf-twitch__start" onClick={() => setOn(true)}>
            <span className="wf-twitch__play" aria-hidden="true">
              <IconPlay />
            </span>
            <span className="wf-twitch__label">Assistir aqui</span>
            <span className="wf-twitch__note">O player da Twitch carrega depois do clique.</span>
          </button>
        )}
      </div>
      <p className="wf-twitch__foot">
        <a
          href={TWITCH_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="wf-btn wf-btn--ghost wf-btn--sm"
        >
          Abrir na Twitch
        </a>
      </p>
    </section>
  );
}
