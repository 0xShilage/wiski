'use client';
import { useEffect, useState } from 'react';
import { countdownParts, countdownSentence, pad2 } from '@/lib/live/countdown';

const UNITS = [
  ['days', 'dias'],
  ['hours', 'horas'],
  ['minutes', 'min'],
  ['seconds', 'seg'],
] as const;

/**
 * "Em breve" countdown (2026-11-11). The first render uses the server's clock (`serverNow`), so
 * the HTML the server sent and the browser's first render are the same (no hydration mismatch);
 * then it ticks every second from the browser's clock. role="timer" is not announced on every
 * tick; its label is the minute-level sentence.
 */
export function SoonCountdown({ target, serverNow }: { target: string; serverNow: number }) {
  const targetMs = Date.parse(target);
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, []);
  const p = countdownParts(targetMs, now);
  if (p.done) {
    return <p className="wf-countdown wf-countdown--done">{countdownSentence(p)}</p>;
  }
  return (
    <div className="wf-countdown" role="timer" aria-label={countdownSentence(p)}>
      {UNITS.map(([key, label]) => (
        <span key={key} className="wf-countdown__unit" aria-hidden="true">
          <span className="wf-countdown__n">{key === 'days' ? p.days : pad2(p[key])}</span>
          <span className="wf-countdown__l">{label}</span>
        </span>
      ))}
    </div>
  );
}
