import { ACCENT_RE } from '@/lib/accent';

/**
 * Ambient glow (2026-11-11): light in the poster's own colour, pooled behind the poster and washed
 * across the bottom of the hero, like a screen lighting a dark room. The colour reaches the page
 * only as an SVG presentation attribute (`stop-color`), which the CSP allows (no style attribute,
 * no <style>), and only when it is a plain #rrggbb (the database CHECK says the same). Without an
 * accent there is no glow and the page looks as before.
 */
export function AmbientGlow({ color, part }: { color: string | null; part: 'wash' | 'halo' }) {
  if (!color || !ACCENT_RE.test(color)) return null;
  const id = `wf-ambient-${part}`;
  return (
    <svg
      className={`wf-ambient wf-ambient--${part}`}
      data-accent={color}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={id} cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={color} stopOpacity={part === 'halo' ? 0.75 : 0.5} />
          <stop offset="0.45" stopColor={color} stopOpacity={part === 'halo' ? 0.28 : 0.18} />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${id})`} />
    </svg>
  );
}
