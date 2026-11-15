'use client';

import { useEffect, useRef } from 'react';

/**
 * Material and light (2026-11-14): a soft pool of light follows the mouse over the dark page, like
 * a flashlight in a theater. One fixed element, moved with a transform through the CSSOM (no
 * repaint, no style attribute — the CSP allows the CSSOM); fades out when the pointer leaves or
 * rests a while. Only for a mouse that can hover, never with reduced motion (CSS hides it too).
 */
export function Flashlight() {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const light = el.current;
    if (!light) return;
    const allowed = window.matchMedia(
      '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
    );
    let frame = 0;
    let x = 0;
    let y = 0;
    let rest: ReturnType<typeof setTimeout> | undefined;
    const paint = () => {
      frame = 0;
      light.style.setProperty('transform', `translate3d(${x}px, ${y}px, 0)`);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !allowed.matches) return;
      x = e.clientX;
      y = e.clientY;
      light.classList.add('is-on');
      clearTimeout(rest);
      rest = setTimeout(() => light.classList.remove('is-on'), 2_500);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const off = () => light.classList.remove('is-on');
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', off);
    window.addEventListener('blur', off);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', off);
      window.removeEventListener('blur', off);
      clearTimeout(rest);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return <div ref={el} className="wf-flashlight" aria-hidden="true" />;
}
