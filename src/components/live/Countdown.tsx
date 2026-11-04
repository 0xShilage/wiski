'use client';
import { useEffect, useState } from 'react';
import { countdownText } from '@/lib/queue-position';

/**
 * "Começa em 2d 03h" — ticks every 20 s in the browser. The server renders the same text, so a
 * page without JavaScript still shows it (the first tick may differ by a minute: no mismatch
 * warning for that text node).
 */
export function Countdown({ to, prefix }: { to: string; prefix: string }) {
  const target = Date.parse(to);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  const text = countdownText(new Date(target), new Date(now));
  return (
    <p className="wf-queue-card__countdown">
      <span>{prefix}</span>{' '}
      <strong suppressHydrationWarning>
        {text === 'agora' ? 'a qualquer momento' : `em ${text}`}
      </strong>
    </p>
  );
}
