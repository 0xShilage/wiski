'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTurnstile } from '@/lib/turnstile-client';

export type TurnstileState = 'loading' | 'ready' | 'error';

/** Renders the Turnstile widget into `ref` while mounted; `reset()` after every submit. */
export function useTurnstile(siteKey: string, action: string) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<TurnstileState>('loading');

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !ref.current) return;
        widget.current = api.render(ref.current, {
          sitekey: siteKey,
          action,
          theme: 'dark',
          language: 'pt-br',
          size: 'flexible',
          callback: (t) => {
            setToken(t);
            setState('ready');
          },
          'expired-callback': () => setToken(null),
          'error-callback': () => {
            setToken(null);
            setState('error');
          },
        });
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action]);

  const reset = useCallback(() => {
    setToken(null);
    if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, []);

  return { ref, token, state, reset };
}
