'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** A pointer resting this long on a link means intent (a sweep across the page doesn't). */
const HOVER_MS = 70;
/** The same address isn't fetched again for this long (Next keeps it for staleTimes.static). */
const AGAIN_MS = 25_000;
/** At most this many intent fetches per window, so nginx's per-IP burst is never in reach. */
const BUDGET = 8;
const WINDOW_MS = 10_000;

/**
 * "Instant" navigation (2026-11-14). The site's links don't prefetch on sight (NavLinks: ten tabs ×
 * every page view ate into nginx's burst, and every page is rendered per request anyway). Instead,
 * when someone shows intent on an internal link — the mouse rests on it, a finger touches it, or
 * the keyboard focuses it — the whole next page (data included) is fetched right then, so the click
 * a moment later lands at once and the poster can morph into the title page. A fetched page stays
 * fresh for 30 s (next.config `staleTimes.static`). Same-origin pages only: never /api or /media,
 * never another tab, a download or the page already open. Mounted once in the site layout.
 */
export function IntentPrefetch() {
  const router = useRouter();
  useEffect(() => {
    const seen = new Map<string, number>();
    let spent: number[] = [];
    let hover: ReturnType<typeof setTimeout> | undefined;

    function target(el: EventTarget | null): string | null {
      const a = (el as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement)) return null;
      if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return null;
      if (a.dataset.noPrefetch !== undefined) return null;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin) return null;
      if (/^\/(?:api|media|admin|_next)(?:\/|$)/.test(to.pathname)) return null;
      if (to.pathname === location.pathname && to.search === location.search) return null;
      return to.pathname + to.search;
    }
    function go(href: string) {
      const now = Date.now();
      if (now - (seen.get(href) ?? -Infinity) < AGAIN_MS) return;
      spent = spent.filter((t) => now - t < WINDOW_MS);
      if (spent.length >= BUDGET) return;
      spent.push(now);
      seen.set(href, now);
      // `kind: 'full'`: the page's data too, not just its shell (every page here is dynamic)
      (router.prefetch as (href: string, o?: { kind: 'full' }) => void)(href, { kind: 'full' });
    }
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const href = target(e.target);
      clearTimeout(hover);
      if (href) hover = setTimeout(() => go(href), HOVER_MS);
    };
    const onOut = () => clearTimeout(hover);
    const onTouch = (e: TouchEvent) => {
      const href = target(e.target);
      if (href) go(href);
    };
    const onFocus = (e: FocusEvent) => {
      const href = target(e.target);
      if (href) go(href);
    };
    document.addEventListener('pointerover', onOver, { passive: true });
    document.addEventListener('pointerout', onOut, { passive: true });
    document.addEventListener('touchstart', onTouch, { passive: true });
    document.addEventListener('focusin', onFocus);
    return () => {
      clearTimeout(hover);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('touchstart', onTouch);
      document.removeEventListener('focusin', onFocus);
    };
  }, [router]);
  return null;
}
