'use client';

import { useEffect, useRef } from 'react';

/**
 * Live updates (03 §6): Server-Sent Events, with polling every 4 s while the stream is down
 * (proxy without streaming, too many open tabs → 429, offline). `onData` gets the parsed JSON of
 * either source; both carry the same fields.
 */
export function useEventStream<T>(opts: {
  url: string | null;
  event: string;
  pollUrl: string;
  /** maps the poll response to the event payload */
  fromPoll: (json: unknown) => T | null;
  onData: (data: T) => void;
}) {
  const cb = useRef(opts);
  useEffect(() => {
    cb.current = opts;
  });

  const { url, event, pollUrl } = opts;
  useEffect(() => {
    if (!url) return;
    let es: EventSource | null = null;
    let poll: number | null = null;
    let stopped = false;

    const startPolling = () => {
      if (poll !== null || stopped) return;
      const tick = async () => {
        try {
          const res = await fetch(pollUrl, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
          });
          if (res.ok) {
            const data = cb.current.fromPoll(await res.json());
            if (data) cb.current.onData(data);
          }
        } catch {
          // offline: try again on the next tick
        }
      };
      poll = window.setInterval(() => void tick(), 4_000);
      void tick();
    };
    const stopPolling = () => {
      if (poll !== null) window.clearInterval(poll);
      poll = null;
    };

    if ('EventSource' in window) {
      es = new EventSource(url, { withCredentials: true });
      es.addEventListener(event, (e) => {
        stopPolling();
        try {
          cb.current.onData(JSON.parse((e as MessageEvent<string>).data) as T);
        } catch {
          // malformed frame: ignore, the next one or a poll will correct it
        }
      });
      es.onerror = () => {
        // EventSource retries by itself (retry: 3000); poll meanwhile.
        startPolling();
        if (es?.readyState === EventSource.CLOSED) es = null;
      };
    } else {
      startPolling();
    }
    return () => {
      stopped = true;
      es?.close();
      stopPolling();
    };
  }, [url, event, pollUrl]);
}
