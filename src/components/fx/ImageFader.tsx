'use client';

import { useEffect } from 'react';
import { LQIP_PATTERN } from '@/lib/media';

/**
 * Blur-up (2026-11-14): every <picture data-lqip> (MediaPicture) gets its tiny placeholder painted
 * behind it — a CSS variable set through the CSSOM, which the CSP allows (inline style attributes
 * it doesn't) — and an image still on its way fades in over it when it arrives. Images already
 * loaded are left alone; new ones (client navigations) are picked up by a MutationObserver. With
 * reduced motion the image still replaces the placeholder, just without the fade (CSS).
 */
export function ImageFader() {
  useEffect(() => {
    const prepare = (root: ParentNode) => {
      for (const pic of root.querySelectorAll<HTMLElement>('picture[data-lqip]:not([data-lq])')) {
        pic.dataset.lq = '1';
        const lqip = pic.dataset.lqip ?? '';
        const img = pic.querySelector('img');
        if (!img || !LQIP_PATTERN.test(lqip)) continue;
        if (img.complete && img.naturalWidth > 0) continue; // already here: nothing to soften
        pic.style.setProperty('--lq', `url("${lqip}")`);
        img.classList.add('is-pending');
        const done = () => {
          img.classList.replace('is-pending', 'is-arriving');
          // keep the placeholder until the fade has finished, then drop it
          setTimeout(() => {
            img.classList.remove('is-arriving');
            pic.style.removeProperty('--lq');
          }, 700);
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }
    };
    prepare(document);
    const mo = new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes) if (n instanceof Element) prepare(n.parentNode ?? n);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return null;
}
