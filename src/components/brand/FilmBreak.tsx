/**
 * "Fita quebrada" (2026-11-14): the error pages' art. A film strip runs through the projector
 * gate (countdown leader 3, 2… then the error code), stops, burns through the middle frame and
 * snaps in two; the halves hang there, the burnt edge still glowing. With reduced motion only the
 * last picture is drawn. Pure SVG + CSS classes (no inline styles: the CSP has no
 * 'unsafe-inline'); the film is drawn three times (whole while it runs, then the two halves)
 * instead of <use>, whose shadow copies don't animate reliably everywhere. Decorative: the
 * page's heading carries the message.
 */

const FRAME_W = 180;
const FRAME_H = 112;
const FRAME_Y = 59;
const PITCH = 195;
/** frame k sits at x = 15 + k·195; frame 1 is the one in the gate at the end */
const FRAMES = [-3, -2, -1, 0, 1, 2, 3, 4] as const;
const LEADER: Partial<Record<number, string>> = { [-1]: '3', 0: '2' };

/** a lumpy burn hole around the middle frame's centre (300, 115) */
const BURN =
  'M300 77 C313 75 327 81 334 93 C341 105 340 121 333 133 C325 145 310 152 296 150 C281 148 267 138 264 123 C262 110 267 95 278 86 C284 80 292 78 300 77 Z';
/** the jagged tear, top to bottom, through the hole */
const TEAR = '296,30 306,62 291,92 310,128 293,162 304,200 304,230';

function Film({ code }: { code: string }) {
  return (
    <g className="wf-fb__run">
      <g mask="url(#wf-fb-burn)">
        <rect x="-600" y="30" width="1800" height="170" className="wf-fb__base" />
        <rect x="-600" y="38" width="1800" height="12" fill="url(#wf-fb-holes)" />
        <rect x="-600" y="180" width="1800" height="12" fill="url(#wf-fb-holes)" />
        <g className="wf-fb__frames">
          {FRAMES.map((k) => {
            const x = 15 + k * PITCH;
            const cx = x + FRAME_W / 2;
            const cy = FRAME_Y + FRAME_H / 2;
            return (
              <g key={k}>
                <rect
                  x={x}
                  y={FRAME_Y}
                  width={FRAME_W}
                  height={FRAME_H}
                  rx="5"
                  fill="url(#wf-fb-frame)"
                />
                {LEADER[k] ? (
                  <g className="wf-fb__leader">
                    <circle cx={cx} cy={cy} r="40" />
                    <circle cx={cx} cy={cy} r="31" />
                    <line x1={cx - 70} y1={cy} x2={cx + 70} y2={cy} />
                    <line x1={cx} y1={FRAME_Y + 6} x2={cx} y2={FRAME_Y + FRAME_H - 6} />
                    <text x={cx} y={cy + 17} textAnchor="middle" className="wf-fb__count">
                      {LEADER[k]}
                    </text>
                  </g>
                ) : null}
                {k === 1 ? (
                  <text x={cx} y={cy + 26} textAnchor="middle" className="wf-fb__code">
                    {code}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
        {/* scorched film around the hole, and the glowing edge (half of it falls in the hole) */}
        <g transform="translate(300 114) scale(1.45) translate(-300 -114)">
          <path d={BURN} className="wf-fb__burn wf-fb__char" filter="url(#wf-fb-soft)" />
        </g>
        <g transform="translate(300 114) scale(1.05) translate(-300 -114)">
          <path d={BURN} className="wf-fb__burn wf-fb__ember" filter="url(#wf-fb-glow)" />
          <path d={BURN} className="wf-fb__burn wf-fb__ember-core" />
        </g>
      </g>
    </g>
  );
}

export function FilmBreak({ code }: { code: string }) {
  return (
    <svg className="wf-fb" viewBox="0 0 600 230" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="wf-fb-holes" width="24" height="12" patternUnits="userSpaceOnUse">
          <rect x="7" y="0" width="10" height="12" rx="2.5" fill="rgb(229 221 237 / 0.16)" />
        </pattern>
        <linearGradient id="wf-fb-frame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2c53" />
          <stop offset="1" stopColor="#21182f" />
        </linearGradient>
        <filter id="wf-fb-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="wf-fb-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <mask id="wf-fb-burn" maskUnits="userSpaceOnUse" x="-700" y="0" width="2000" height="230">
          <rect x="-700" y="0" width="2000" height="230" fill="#fff" />
          <path d={BURN} fill="#000" className="wf-fb__burn wf-fb__hole" />
        </mask>
        <clipPath id="wf-fb-left">
          <polygon points={`-700,0 296,0 ${TEAR} -700,230`} />
        </clipPath>
        <clipPath id="wf-fb-right">
          <polygon points={`296,0 1300,0 1300,230 ${TEAR.split(' ').reverse().join(' ')}`} />
        </clipPath>
      </defs>
      <g className="wf-fb__whole">
        <Film code={code} />
      </g>
      <g className="wf-fb__half wf-fb__half--left" clipPath="url(#wf-fb-left)">
        <Film code={code} />
      </g>
      <g className="wf-fb__half wf-fb__half--right" clipPath="url(#wf-fb-right)">
        <Film code={code} />
      </g>
      <g className="wf-fb__sparks">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={i} cx="300" cy="114" r="2.2" />
        ))}
      </g>
    </svg>
  );
}
