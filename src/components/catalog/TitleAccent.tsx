'use client';
import { useEffect, useRef } from 'react';
import { ACCENT_RE } from '@/lib/accent';

/**
 * The title page in the poster's main colour (2026-11-13): sets `--title-accent` on the page so
 * decorations (the line under the title, the glow of the buttons) take it. Set through the CSSOM,
 * which the CSP allows; nothing on the server render. Text keeps the site's colours (an accent can
 * be too dark to read on ink).
 */
export function TitleAccent({ color }: { color: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const page = ref.current?.closest<HTMLElement>('.wf-detail');
    if (!page || !color || !ACCENT_RE.test(color)) return;
    page.style.setProperty('--title-accent', color);
    page.dataset.accented = 'true';
    return () => {
      page.style.removeProperty('--title-accent');
      delete page.dataset.accented;
    };
  }, [color]);
  return <span ref={ref} hidden />;
}
