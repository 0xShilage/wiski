'use client';

import { useEffect, useRef, useState } from 'react';
import { MediaPicture } from '@/components/media/MediaPicture';
import type { Picture } from '@/lib/media';

/** How long each background stays before the next fades in, and how long the fade takes. */
export const BACKDROP_HOLD_MS = 7_000;
export const BACKDROP_FADE_MS = 1_800;

/**
 * A movie's backgrounds (2026-11-14): up to five, fading one into the next on the title page.
 * The first is the page's main image (eager, high priority); the others load one at a time, the
 * next only after the current one is on screen, and a fade starts only once the next image has
 * loaded. The new image fades in over the old one (no dip to black), then the old one steps back.
 * Paused while the tab is hidden; with reduced motion it stays on the first image. Each image
 * keeps the title's slow Ken Burns pan (data-kb). Decorative: aria-hidden, empty alt.
 */
export function BackdropFade({ pictures, kb }: { pictures: Picture[]; kb: number }) {
  const [active, setActive] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  /** layers in the page so far (the first, then each next one as it's needed) */
  const [mounted, setMounted] = useState(1);
  const ready = useRef<Set<number>>(new Set());
  const n = pictures.length;

  // bring in the next image as soon as the current one is up
  const want = Math.min(n, Math.max(mounted, active + 2));
  if (want !== mounted) setMounted(want);

  useEffect(() => {
    if (n < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cur = 0;
    const tick = () => {
      if (!document.hidden) {
        const next = (cur + 1) % n;
        if (ready.current.has(next)) {
          setPrev(cur);
          setActive(next);
          cur = next;
        }
      }
      timer = setTimeout(tick, BACKDROP_HOLD_MS);
    };
    timer = setTimeout(tick, BACKDROP_HOLD_MS);
    return () => clearTimeout(timer);
  }, [n]);

  return (
    <div
      className="wf-detail__art wf-backdrops"
      aria-hidden="true"
      data-kb={kb}
      data-active={active}
    >
      {pictures.slice(0, mounted).map((p, i) => (
        <Layer
          key={i}
          picture={p}
          first={i === 0}
          state={i === active ? 'on' : i === prev ? 'prev' : 'off'}
          onReady={() => ready.current.add(i)}
        />
      ))}
    </div>
  );
}

function Layer({
  picture,
  first,
  state,
  onReady,
}: {
  picture: Picture;
  first: boolean;
  state: 'on' | 'prev' | 'off';
  onReady: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const img = box.current?.querySelector('img');
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      onReady();
      return;
    }
    img.addEventListener('load', onReady, { once: true });
    return () => img.removeEventListener('load', onReady);
  }, [onReady]);
  return (
    <div ref={box} className="wf-backdrops__layer" data-state={state}>
      <MediaPicture picture={picture} alt="" sizes="100vw" priority={first} />
    </div>
  );
}
