'use client';
import { useEffect, useState } from 'react';
import { TWITCH_URL } from '@/lib/twitch';

type Status = { live: boolean; now: string | null };

const EVERY_MS = 60_000;
const LIVE_ICON = '/fx/icon-live.png';

/**
 * The tab's icon shows a red dot while Iara is live (2026-11-14): the page's icon links point at
 * the live icon, and back to their own when the live ends (kept in data-wf-href).
 */
function liveFavicon(live: boolean) {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
    const own = link.dataset.wfHref ?? link.getAttribute('href') ?? '';
    link.dataset.wfHref = own;
    const want = live ? LIVE_ICON : own;
    if (link.getAttribute('href') !== want) link.setAttribute('href', want);
    if (live) link.removeAttribute('sizes');
  }
}

/**
 * "AO VIVO" bar (2026-11-10): a slim strip above the header while a live is "Ao vivo" in
 * Cronograma — pulsing red dot, what is on screen, a link to the Twitch channel. The header lives
 * in the layout (it doesn't re-render on navigation), so after the server's first answer the bar
 * asks `/api/v1/live` once a minute while the tab is visible, and again when it comes back.
 * Its presence also moves the header down and lights the logo up a little more (CSS `:has`), and
 * the tab's icon gets a red dot (2026-11-14).
 */
export function LiveBar({ initial }: { initial: Status }) {
  const [status, setStatus] = useState(initial);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/v1/live', { headers: { accept: 'application/json' } });
        if (!r.ok) return;
        const s = (await r.json()) as Status;
        if (!stop && typeof s.live === 'boolean')
          setStatus({ live: s.live, now: typeof s.now === 'string' ? s.now : null });
      } catch {
        // offline: keep what we have
      }
    };
    const t = setInterval(() => void check(), EVERY_MS);
    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  useEffect(() => liveFavicon(status.live), [status.live]);
  if (!status.live) return null;
  return (
    <a className="wf-livebar" href={TWITCH_URL} target="_blank" rel="noopener noreferrer">
      <span className="wf-livebar__dot" aria-hidden="true" />
      <b className="wf-livebar__tag">Ao vivo</b>
      <span className="wf-livebar__now">
        {status.now ? `Agora: ${status.now}` : 'A Iara está ao vivo'}
      </span>
      <span className="wf-livebar__cta">
        Assistir na Twitch<span aria-hidden="true"> →</span>
      </span>
    </a>
  );
}
