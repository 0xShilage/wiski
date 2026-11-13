import { PALETTE_RE } from '@/lib/palette';

/**
 * Paleta do filme (2026-11-13): the poster's colours as a strip of swatches under the title. The
 * colours reach the page only as SVG `fill` attributes (the CSP allows them; no style attribute),
 * and only plain #rrggbb values (the database CHECK says the same).
 */
export function PosterPalette({ colors }: { colors: string[] }) {
  const shown = colors.filter((c) => PALETTE_RE.test(c));
  if (shown.length < 2) return null;
  const W = 30;
  return (
    <div className="wf-palette">
      <span className="wf-palette__label" aria-hidden="true">
        Paleta
      </span>
      <svg
        className="wf-palette__strip"
        viewBox={`0 0 ${shown.length * W - 6} 22`}
        role="img"
        aria-label={`Paleta do pôster: ${shown.join(', ')}`}
        focusable="false"
      >
        {shown.map((c, i) => (
          <rect key={c} x={i * W} y="0" width={W - 6} height="22" rx="6" fill={c}>
            <title>{c}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
