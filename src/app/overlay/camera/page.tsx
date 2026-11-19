import type { Metadata } from 'next';
import { overlayText } from '@/server/overlay/events';

export const metadata: Metadata = {
  title: 'Moldura da câmera',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /overlay/camera (2026-11-18): a 16:9 camera frame for OBS, flat 80s Miami sunset — a rim in the
 * sunset palette (#FFB458 → #3B146B) with a hard offset shadow, palm fronds over it that sway,
 * sketched stars that twinkle in two corners, an optional "AO VIVO" tag and name plate. The art is
 * one SVG on a 1600 × 900 grid, so it keeps its shape at any 16:9 size; the camera shows through
 * the middle (transparent). Decoration only: no data, no key. `?nome=` / `?sub=` fill the plate
 * (plain text, cut short); `?ao-vivo=0` hides the tag. All drawings are original.
 */
export default async function CameraFramePage({ searchParams }: Props) {
  const q = await searchParams;
  const name = overlayText(one(q.nome) ?? null, 18);
  const sub = overlayText(one(q.sub) ?? null, 30);
  const live = one(q['ao-vivo']) !== '0';
  return (
    <main className="wf-overlay wf-cam">
      <h1 className="sr-only">Moldura da câmera</h1>
      <Frame />
      {live ? (
        <p className="wf-cam__live">
          <span className="wf-cam__dot" aria-hidden="true" />
          AO VIVO
        </p>
      ) : null}
      {name ? (
        <div className="wf-cam__plate">
          <span className="wf-cam__name">{name}</span>
          {sub ? <span className="wf-cam__sub">{sub}</span> : null}
        </div>
      ) : null}
    </main>
  );
}

// ── the drawing (1600 × 900) ─────────────────────────────────────────────────

const W = 1600;
const H = 900;
/** the frame: outer edge, rim width, shadow offset */
const O = { x: 14, y: 14, w: 1560, h: 856, r: 64 };
const RIM = 60;
const I = { x: O.x + RIM, y: O.y + RIM, w: O.w - 2 * RIM, h: O.h - 2 * RIM, r: 28 };
const SHADOW = { dx: 9, dy: 11 };

/** A rounded rectangle as path data. */
function rr(x: number, y: number, w: number, h: number, r: number) {
  return [
    `M${x + r} ${y}`,
    `H${x + w - r}`,
    `Q${x + w} ${y} ${x + w} ${y + r}`,
    `V${y + h - r}`,
    `Q${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `H${x + r}`,
    `Q${x} ${y + h} ${x} ${y + h - r}`,
    `V${y + r}`,
    `Q${x} ${y} ${x + r} ${y}`,
    'Z',
  ].join(' ');
}
const RIM_PATH = `${rr(O.x, O.y, O.w, O.h, O.r)} ${rr(I.x, I.y, I.w, I.h, I.r)}`;

const f = (n: number) => Math.round(n * 10) / 10;

/**
 * A palm frond: a thin curved midrib from (x, y) at `angle` (degrees) for `len`, bending by
 * `bend`, with long narrow leaflets on both sides — each a separate blade swept back towards the
 * stem, longest in the middle, a little uneven. One closed path.
 */
function frond(x: number, y: number, angle: number, len: number, bend: number, leaflets = 15) {
  const a = (angle * Math.PI) / 180;
  const dir = { x: Math.cos(a), y: Math.sin(a) };
  const nor = { x: -dir.y, y: dir.x };
  const at = (t: number) => {
    const off = bend * t * t;
    return { x: x + dir.x * len * t + nor.x * off, y: y + dir.y * len * t + nor.y * off };
  };
  const rib = 3; // half the midrib's width
  const side = (s: 1 | -1) => {
    const pts: string[] = [];
    for (let i = 0; i < leaflets; i++) {
      const t = (i + 0.6) / (leaflets + 0.6);
      const p0 = at(t - 0.018);
      const p1 = at(t + 0.018);
      const uneven = 0.85 + 0.3 * Math.abs(Math.sin(i * 2.3 + s));
      const size = len * 0.4 * Math.sin(Math.PI * (0.12 + 0.82 * t)) * (1 - 0.3 * t) * uneven;
      const tip = at(Math.max(0, t - 0.09));
      const out = {
        x: tip.x + s * nor.x * size - dir.x * size * 0.25,
        y: tip.y + s * nor.y * size - dir.y * size * 0.25,
      };
      pts.push(
        `L${f(p0.x + s * nor.x * rib)} ${f(p0.y + s * nor.y * rib)}`,
        `L${f(out.x)} ${f(out.y)}`,
        `L${f(p1.x + s * nor.x * rib)} ${f(p1.y + s * nor.y * rib)}`,
      );
    }
    return pts;
  };
  const end = at(1);
  return `M${f(x)} ${f(y)} ${side(1).join(' ')} L${f(end.x)} ${f(end.y)} ${side(-1).reverse().join(' ')} Z`;
}

/**
 * Fronds lying along the rim, their stems just outside the frame so the leaflets cross it:
 * [x, y, angle, len, bend, sway group].
 */
const FRONDS: [number, number, number, number, number, 'a' | 'b'][] = [
  // top-right corner: along the top edge and down the right edge
  [1630, 34, 178, 430, 34, 'a'],
  [1612, 8, 152, 300, -40, 'b'],
  [1574, -24, 95, 360, -40, 'a'],
  // top-left corner
  [-24, 40, 2, 320, -30, 'b'],
  [34, -24, 82, 290, 30, 'a'],
  // left edge, middle
  [42, 360, 86, 320, 34, 'a'],
  // bottom-left corner
  [-24, 858, -4, 400, 34, 'b'],
  [40, 908, -82, 320, -32, 'a'],
  // bottom edge, middle
  [690, 900, 2, 280, -24, 'b'],
  // bottom-right corner
  [1628, 862, 182, 420, -34, 'a'],
  [1566, 924, -96, 330, 32, 'b'],
  // right edge, middle
  [1556, 420, 94, 280, -30, 'b'],
];

/** A five-point star, drawn twice slightly off, like a quick sketch. */
function star(cx: number, cy: number, r: number, turn = 0) {
  const pts = (rot: number, k: number) =>
    Array.from({ length: 10 }, (_, i) => {
      const a = ((i * 36 + rot - 90) * Math.PI) / 180;
      const d = i % 2 === 0 ? r * k : r * 0.45 * k;
      return `${f(cx + d * Math.cos(a))},${f(cy + d * Math.sin(a))}`;
    }).join(' ');
  return [pts(turn, 1), pts(turn + 7, 0.9)];
}

/** [x, y, radius, turn]: three on the top-right, two on the bottom-left */
const STARS: [number, number, number, number][] = [
  [1352, 38, 30, -8],
  [1430, 60, 24, 12],
  [1508, 36, 18, 4],
  [96, 842, 26, 10],
  [168, 862, 20, -6],
];

function Frame() {
  return (
    <svg
      className="wf-cam__art"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="wf-cam-rim" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#FFB458" />
          <stop offset="0.28" stopColor="#FF9B55" />
          <stop offset="0.5" stopColor="#F87572" />
          <stop offset="0.66" stopColor="#F36A78" />
          <stop offset="0.82" stopColor="#C9349B" />
          <stop offset="1" stopColor="#7B208F" />
        </linearGradient>
        {/* dusk settling on the lower half of the rim */}
        <linearGradient id="wf-cam-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3B146B" stopOpacity="0" />
          <stop offset="1" stopColor="#3B146B" stopOpacity="0.5" />
        </linearGradient>
        <clipPath id="wf-cam-rim-clip">
          <path d={RIM_PATH} clipRule="evenodd" />
        </clipPath>
      </defs>

      {/* hard offset shadow, then the rim */}
      <path
        d={RIM_PATH}
        fillRule="evenodd"
        className="wf-cam__shadow"
        transform={`translate(${SHADOW.dx} ${SHADOW.dy})`}
      />
      <path d={RIM_PATH} fillRule="evenodd" fill="url(#wf-cam-rim)" />

      {/* palm fronds over the rim (clipped to it), two groups swaying out of step */}
      <g clipPath="url(#wf-cam-rim-clip)">
        <g className="wf-cam__sway wf-cam__sway--a">
          {FRONDS.filter((d) => d[5] === 'a').map(([x, y, a, l, b], i) => (
            <path key={i} d={frond(x, y, a, l, b)} className="wf-cam__frond" />
          ))}
        </g>
        <g className="wf-cam__sway wf-cam__sway--b">
          {FRONDS.filter((d) => d[5] === 'b').map(([x, y, a, l, b], i) => (
            <path key={i} d={frond(x, y, a, l, b)} className="wf-cam__frond wf-cam__frond--pink" />
          ))}
        </g>
        <rect
          x={O.x}
          y={O.y + O.h * 0.55}
          width={O.w}
          height={O.h * 0.45}
          fill="url(#wf-cam-haze)"
        />
      </g>

      {/* the edges */}
      <path d={rr(O.x, O.y, O.w, O.h, O.r)} className="wf-cam__edge" />
      <path d={rr(I.x, I.y, I.w, I.h, I.r)} className="wf-cam__edge wf-cam__edge--inner" />

      {/* sketched stars on two corners */}
      {STARS.map(([x, y, r, t], i) => (
        <g key={i} className={`wf-cam__star wf-cam__star--${i}`}>
          {star(x, y, r, t).map((p, j) => (
            <polygon key={j} points={p} />
          ))}
        </g>
      ))}
    </svg>
  );
}
