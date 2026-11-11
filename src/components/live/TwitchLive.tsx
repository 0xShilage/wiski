'use client';
import { useState } from 'react';
import { IconPlay } from '@/components/ui/icons';
import { BULB_R, MARQUEE_H, MARQUEE_W, marqueeBulbs } from '@/lib/marquee';
import { TWITCH_CHANNEL, TWITCH_URL, twitchPlayerUrl } from '@/lib/twitch';

const BULBS = marqueeBulbs();

/**
 * "Ao vivo agora" (2026-11-02), below "Nosso progresso" while a live is marked "Ao vivo" in
 * Cronograma. Like the trailers, the Twitch player is created only after the click: nothing loads
 * from Twitch before (no cookies, no IP sent to a third party just for opening the home page).
 * Marquee lights (2026-11-11): the player is framed by theatre-marquee bulbs with a light running
 * around them (steady with "reduce motion"). The bulbs are SVG circles; their colour comes from
 * classes.
 */
export function TwitchLive({ parent }: { parent: string }) {
  const [on, setOn] = useState(false);
  return (
    <section className="wf-twitch" aria-labelledby="ao-vivo-agora">
      <h2 id="ao-vivo-agora" className="wf-h2">
        <span className="wf-twitch__dot" aria-hidden="true" />
        Ao vivo agora
      </h2>
      <div className="wf-marquee">
        <svg
          className="wf-marquee__bulbs"
          viewBox={`0 0 ${MARQUEE_W} ${MARQUEE_H}`}
          aria-hidden="true"
          focusable="false"
        >
          {BULBS.map((b, i) => (
            <circle
              key={i}
              className={`wf-bulb wf-bulb--${b.phase}`}
              cx={b.x}
              cy={b.y}
              r={BULB_R}
            />
          ))}
        </svg>
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
