'use client';
import type { KeyboardEvent } from 'react';
import type { Era, Place } from '@/lib/guides/dark-s1';

/**
 * The illustrated map of Winden (2026-11-11): our own drawing, not to scale — forest, river,
 * town, the power plant's cooling towers (a building site in 1953) and the caves. Places are SVG
 * buttons; their positions and every colour are attributes or classes (CSP: no inline styles).
 */

const W = 1000;
const H = 620;

/** deterministic scatter of trees inside the forest, away from the places */
function trees(places: { x: number; y: number }[]): { x: number; y: number; s: number }[] {
  const out: { x: number; y: number; s: number }[] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let gy = 10; gy < H; gy += 34) {
    for (let gx = 10; gx < W; gx += 34) {
      const x = gx + rnd() * 22;
      const y = gy + rnd() * 22;
      if (!inForest(x, y)) continue;
      if (Math.abs(x - riverX(y)) < 30) continue;
      if (places.some((p) => Math.hypot(p.x - x, p.y - y) < 46)) continue;
      out.push({ x, y, s: 0.75 + rnd() * 0.5 });
    }
  }
  return out;
}

/** the forest's southern edge, as a function of x (and everything east of the river) */
function forestEdge(x: number): number {
  return 235 + 40 * Math.sin(x / 90) + (x > 600 ? (x - 600) * 0.35 : 0);
}
function inForest(x: number, y: number): boolean {
  if (x > 700 && x < 890 && y > 150 && y < 320) return false; // the plant's clearing
  return y < forestEdge(x) || x > 880;
}
function riverX(y: number): number {
  return 905 + 30 * Math.sin(y / 70);
}

const FOREST_PATH = (() => {
  const pts: string[] = [];
  for (let x = 0; x <= 880; x += 20) pts.push(`${x},${forestEdge(x).toFixed(1)}`);
  return `M0,0 H${W} V${H} H900 L880,${forestEdge(880).toFixed(1)} L${pts.reverse().join(' L')} Z`;
})();

const RIVER_PATH = (() => {
  const pts: string[] = [];
  for (let y = -10; y <= H + 10; y += 20) pts.push(`${riverX(y).toFixed(1)},${y}`);
  return `M${pts.join(' L')}`;
})();

const BLOCKS: [number, number, number, number][] = [
  [60, 350, 70, 40],
  [150, 450, 60, 34],
  [250, 360, 54, 40],
  [260, 540, 70, 36],
  [380, 390, 60, 40],
  [400, 480, 46, 30],
  [560, 520, 64, 40],
  [690, 400, 56, 34],
  [720, 520, 70, 44],
  [60, 430, 44, 30],
  [180, 560, 50, 32],
  [610, 400, 40, 30],
];

function Icon({ kind }: { kind: Place['icon'] }) {
  switch (kind) {
    case 'cave':
      return (
        <path
          className="wf-wpin__icon"
          d="M-9,7 Q-9,-8 0,-8 Q9,-8 9,7 Z M-3,7 Q-3,0 0,0 Q3,0 3,7 Z"
          fillRule="evenodd"
        />
      );
    case 'plant':
      return (
        <path
          className="wf-wpin__icon"
          d="M-8,8 C-5,2 -5,-2 -7,-8 H-1 C-3,-2 -3,2 -1,8 Z M1,8 C4,2 4,-2 2,-8 H8 C6,-2 6,2 8,8 Z"
        />
      );
    case 'school':
      return (
        <path
          className="wf-wpin__icon"
          d="M-9,8 V-1 L0,-8 L9,-1 V8 Z M-2,8 V2 H2 V8 Z"
          fillRule="evenodd"
        />
      );
    case 'police':
      return (
        <path className="wf-wpin__icon" d="M0,-9 L8,-5 V1 C8,5 4,8 0,9 C-4,8 -8,5 -8,1 V-5 Z" />
      );
    case 'house':
      return <path className="wf-wpin__icon" d="M-8,8 V-1 L0,-8 L8,-1 V8 H2 V3 H-2 V8 Z" />;
    case 'hotel':
      return <path className="wf-wpin__icon" d="M-7,-8 H-3 V-2 H3 V-8 H7 V8 H3 V2 H-3 V8 H-7 Z" />;
    case 'care':
      return <path className="wf-wpin__icon" d="M-3,-8 H3 V-3 H8 V3 H3 V8 H-3 V3 H-8 V-3 H-3 Z" />;
    case 'clock':
      return (
        <>
          <circle className="wf-wpin__icon wf-wpin__icon--ring" r="8" />
          <path className="wf-wpin__hand" d="M0,0 V-5 M0,0 L4,2" />
        </>
      );
  }
}

export function WindenMap({
  era,
  places,
  selected,
  highlighted,
  onSelect,
}: {
  era: Era;
  places: (Place & { text: string })[];
  selected: string | null;
  highlighted: ReadonlySet<string>;
  onSelect: (id: string) => void;
}) {
  const forest = trees(places);
  const key = (id: string) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(id);
    }
  };
  return (
    <svg
      className="wf-winden"
      data-era={era}
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label={`Mapa ilustrado de Winden em ${era}`}
    >
      <defs>
        <symbol id="wf-tree" viewBox="-10 -16 20 22" overflow="visible">
          <path d="M0,-16 L8,-2 H4 L10,6 H-10 L-4,-2 H-8 Z" />
        </symbol>
        <radialGradient id="wf-winden-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#a99de0" stopOpacity="0.5" />
          <stop offset="1" stopColor="#a99de0" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect className="wf-winden__ground" width={W} height={H} />
      <path className="wf-winden__forest" d={FOREST_PATH} />
      <path className="wf-winden__river" d={RIVER_PATH} />
      <path className="wf-winden__river-shine" d={RIVER_PATH} />

      {/* roads and the forest track to the caves */}
      <path className="wf-winden__road" d="M0,430 C200,420 420,440 640,430 S820,380 860,330" />
      <path className="wf-winden__road" d="M330,440 C340,360 300,290 230,200" />
      <path className="wf-winden__road" d="M640,430 C690,360 740,320 780,290" />
      <path className="wf-winden__track" d="M360,300 C420,250 470,210 520,170" />
      <path
        className="wf-winden__road wf-winden__road--minor"
        d="M120,320 C130,380 150,480 110,520"
      />
      <path
        className="wf-winden__road wf-winden__road--minor"
        d="M470,545 C520,520 600,500 640,470"
      />

      {BLOCKS.map(([x, y, w, h], i) => (
        <rect key={i} className="wf-winden__block" x={x} y={y} width={w} height={h} rx="4" />
      ))}

      {forest.map((t, i) => (
        <use
          key={i}
          href="#wf-tree"
          className={i % 3 ? 'wf-winden__tree' : 'wf-winden__tree wf-winden__tree--dark'}
          x={t.x - 10 * t.s}
          y={t.y - 16 * t.s}
          width={20 * t.s}
          height={22 * t.s}
        />
      ))}

      {/* the power plant: cooling towers and steam, or the building site in 1953 */}
      {era === '1953' ? (
        <g className="wf-winden__site" aria-hidden="true">
          <rect x="740" y="220" width="110" height="70" rx="3" className="wf-winden__dig" />
          <path d="M760,300 V170 H840 M820,170 V190" className="wf-winden__crane" />
          <path d="M748,296 h96" className="wf-winden__fence" />
        </g>
      ) : (
        <g className="wf-winden__plant" aria-hidden="true">
          <path
            className="wf-winden__tower"
            d="M728,300 C738,262 738,236 730,206 H770 C762,236 762,262 772,300 Z"
          />
          <path
            className="wf-winden__tower"
            d="M832,300 C842,262 842,236 834,206 H874 C866,236 866,262 876,300 Z"
          />
          <rect className="wf-winden__building" x="770" y="262" width="62" height="38" rx="3" />
          <g className="wf-winden__steam">
            <circle cx="750" cy="190" r="16" />
            <circle cx="764" cy="170" r="20" />
            <circle cx="854" cy="190" r="16" />
            <circle cx="868" cy="168" r="21" />
          </g>
        </g>
      )}

      <g className="wf-winden__rain" aria-hidden="true">
        {Array.from({ length: 70 }, (_, i) => {
          const x = (i * 137) % W;
          const y = (i * 89) % H;
          return <path key={i} d={`M${x},${y} l-6,18`} />;
        })}
      </g>

      {places.map((p) => {
        const on = selected === p.id;
        const lit = highlighted.has(p.id);
        return (
          <g
            key={p.id}
            className={`wf-wpin${on ? ' is-on' : ''}${lit ? ' is-lit' : ''}`}
            transform={`translate(${p.x} ${p.y})`}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={p.name}
            data-place={p.id}
            onClick={() => onSelect(p.id)}
            onKeyDown={key(p.id)}
          >
            {on || lit ? (
              <circle className="wf-wpin__halo" r="46" fill="url(#wf-winden-glow)" />
            ) : null}
            <circle className="wf-wpin__hit" r="30" />
            <circle className="wf-wpin__dot" r="17" />
            <Icon kind={p.icon} />
            <text className="wf-wpin__label" y="36" textAnchor="middle">
              {p.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
