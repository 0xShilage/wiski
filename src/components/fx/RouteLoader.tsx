'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { FilmLoader } from './FilmLoader';

/** Shown only when the next page takes longer than this (fast pages never flash it). */
const DELAY_MS = 220;
/** A navigation that never lands (offline, an error page) stops showing it after this. */
const GIVE_UP_MS = 20_000;

/**
 * "Carregamento em quadros" between pages (2026-11-14). Every page is rendered per request and the
 * links don't prefetch (NavLinks), and nginx buffers page responses, so a route `loading.tsx`
 * would never show (and would turn the title pages' 404s into 200s: a loading boundary starts the
 * response before the page runs). Instead: a click on an internal link to another address starts a
 * short timer; if the new address hasn't landed by then, film frames cover the old page under the
 * header until it does. Mounted once in the site layout, inside <Suspense> (search params).
 */
export function RouteLoader() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  const here = `${pathname}?${search}`;
  /** the address the click left from, once the delay is over; shown only while it's still here */
  const [leaving, setLeaving] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // landed somewhere new: forget the old address (React's "adjust state while rendering"), so
  // coming back to it with the browser's back button doesn't bring the frames back
  const [seen, setSeen] = useState(here);
  if (seen !== here) {
    setSeen(here);
    if (leaving !== null) setLeaving(null);
  }

  useEffect(() => {
    const clear = () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement)) return;
      if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin) return;
      if (to.pathname.startsWith('/api/') || to.pathname.startsWith('/media/')) return;
      if (to.pathname === location.pathname && to.search === location.search) return; // same page, or a #hash
      const at = () => `${location.pathname}?${new URLSearchParams(location.search).toString()}`;
      const from = at();
      clear();
      timers.current = [
        // still here after the delay (a fast page has already landed: nothing to show)
        setTimeout(() => {
          if (at() === from) setLeaving(from);
        }, DELAY_MS),
        setTimeout(() => setLeaving(null), GIVE_UP_MS),
      ];
    }
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      clear();
    };
  }, []);

  // once the new address lands, `here` moves on and the frames go (a late timer changes nothing)
  if (leaving === null || leaving !== here) return null;
  return (
    <div className="wf-route-loader">
      <div className="wf-page">
        <FilmLoader size="page" label="Carregando a página…" />
      </div>
    </div>
  );
}
