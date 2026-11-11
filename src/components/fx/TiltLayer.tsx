'use client';
import { useEffect } from 'react';

/**
 * 3D poster tilt (2026-11-11): an element marked `data-tilt` leans toward the pointer with a
 * glossy glare, like a case on a shelf (`data-tilt="5"` = at most 5°, default 9°). One delegated
 * listener for the whole site, mounted in the site layout.
 *
 * CSP: the values go in as CSS custom properties through the CSSOM (`style.setProperty`), which
 * `style-src` without 'unsafe-inline' allows — never a `style` attribute, which it blocks (and
 * reports). Only for a mouse that can hover and only without "reduce motion"; touch screens keep
 * the flat cards. At rest the cards have no transform at all (styles/showcase.css), so a grid of
 * dozens of posters doesn't turn into dozens of GPU layers.
 */
const DEFAULT_MAX_DEG = 9;
const VARS = ['--tilt-rx', '--tilt-ry', '--glare-x', '--glare-y'] as const;

export function TiltLayer() {
  useEffect(() => {
    const allowed = window.matchMedia(
      '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
    );
    let current: HTMLElement | null = null;
    let last: PointerEvent | null = null;
    let frame = 0;

    const release = () => {
      if (!current) return;
      current.classList.remove('is-tilting');
      for (const v of VARS) current.style.removeProperty(v);
      current = null;
    };
    const paint = () => {
      frame = 0;
      if (!current || !last) return;
      const box = current.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const x = Math.min(1, Math.max(0, (last.clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (last.clientY - box.top) / box.height));
      const max = Number(current.dataset.tilt) || DEFAULT_MAX_DEG;
      current.style.setProperty('--tilt-ry', `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
      current.style.setProperty('--tilt-rx', `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
      current.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
      current.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !allowed.matches) {
        release();
        return;
      }
      const target = e.target instanceof Element ? e.target : null;
      const el = target?.closest<HTMLElement>('[data-tilt]') ?? null;
      if (el !== current) {
        release();
        current = el;
        current?.classList.add('is-tilting');
      }
      if (!current) return;
      last = e;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', release);
    window.addEventListener('scroll', release, { passive: true });
    window.addEventListener('blur', release);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', release);
      window.removeEventListener('scroll', release);
      window.removeEventListener('blur', release);
      if (frame) cancelAnimationFrame(frame);
      release();
    };
  }, []);
  return null;
}
