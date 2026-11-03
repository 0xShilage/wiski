import { useId } from 'react';

/**
 * The goal gauge of the stream overlays (2026-11-02): a glowing gradient ring around a dark disc
 * with an icon, a bright knob at the end of the arc and a few twinkling sparkles. Pure SVG with
 * presentation attributes (no inline styles, no <style>: the CSP has no 'unsafe-inline'); the
 * motion lives in ops.css and is off under prefers-reduced-motion. `burst` re-plays a small
 * particle pop when it changes (the overlay passes the percentage, so progress "pops").
 */
export type GoalIcon = 'sparkle' | 'heart' | 'clock' | 'film' | 'tv' | 'stack';

const R = 50; // ring radius in the 120 × 120 viewBox
const C = 2 * Math.PI * R;

const ICON: Record<GoalIcon, string> = {
  // four-point sparkle
  sparkle: 'M60 38 C62 52 68 58 82 60 C68 62 62 68 60 82 C58 68 52 62 38 60 C52 58 58 52 60 38 Z',
  heart:
    'M60 80 C50 72 40 64 40 54 C40 47 45 42 51 42 C55 42 58 44 60 47 C62 44 65 42 69 42 C75 42 80 47 80 54 C80 64 70 72 60 80 Z',
  clock: 'M60 40 A20 20 0 1 1 59.99 40 Z M58 48 V61 L68 67 L70 63.5 L62 59 V48 Z',
  film: 'M42 46 H78 V74 H42 Z M45 49 V53 H49 V49 Z M45 58 V62 H49 V58 Z M45 67 V71 H49 V67 Z M71 49 V53 H75 V49 Z M71 58 V62 H75 V58 Z M71 67 V71 H75 V67 Z M53 50 V70 H67 V50 Z',
  tv: 'M40 48 H80 V72 H40 Z M44 52 V68 H76 V52 Z M54 76 H66 V79 H54 Z M52 40 L60 47 L68 40 L70 42 L62 48 H58 L50 42 Z',
  stack: 'M46 44 H74 V48 H46 Z M42 51 H78 V55 H42 Z M40 58 H80 V78 H40 Z',
};

export function GoalRing({
  percent,
  icon = 'sparkle',
  size = 'lg',
  burst,
}: {
  percent: number;
  icon?: GoalIcon;
  size?: 'lg' | 'sm';
  burst?: number;
}) {
  const id = useId().replace(/[^\w-]/g, '');
  const p = Math.max(0, Math.min(100, percent));
  const angle = (p / 100) * 2 * Math.PI - Math.PI / 2;
  const kx = 60 + R * Math.cos(angle);
  const ky = 60 + R * Math.sin(angle);
  const done = p >= 100;
  return (
    <svg
      className={`wf-goal-ring wf-goal-ring--${size}${done ? ' is-done' : ''}`}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-arc`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3d9ff" />
          <stop offset="0.5" stopColor="#c9a8ff" />
          <stop offset="1" stopColor="#f2a7dd" />
        </linearGradient>
        <radialGradient id={`${id}-disc`} cx="0.5" cy="0.4" r="0.6">
          <stop offset="0" stopColor="#4b3670" />
          <stop offset="1" stopColor="#1f1530" />
        </radialGradient>
      </defs>
      <circle className="wf-goal-ring__track" cx="60" cy="60" r={R} />
      <circle
        className="wf-goal-ring__arc"
        cx="60"
        cy="60"
        r={R}
        stroke={`url(#${id}-arc)`}
        strokeDasharray={C}
        strokeDashoffset={C * (1 - p / 100)}
        transform="rotate(-90 60 60)"
      />
      <circle className="wf-goal-ring__disc" cx="60" cy="60" r="38" fill={`url(#${id}-disc)`} />
      <path className="wf-goal-ring__icon" d={ICON[icon]} fillRule="evenodd" />
      {p > 0 ? <circle className="wf-goal-ring__knob" cx={kx} cy={ky} r="5" /> : null}
      <g className="wf-goal-ring__sparkles">
        {[
          [14, 22, 1],
          [104, 14, 0.8],
          [112, 86, 1.1],
          [8, 96, 0.7],
          [92, 112, 0.9],
          [30, 6, 0.6],
        ].map(([x, y, s], i) => (
          <path
            key={i}
            d={`M${x} ${y! - 5 * s!} Q${x} ${y} ${x! + 5 * s!} ${y} Q${x} ${y} ${x} ${y! + 5 * s!} Q${x} ${y} ${x! - 5 * s!} ${y} Q${x} ${y} ${x} ${y! - 5 * s!} Z`}
          />
        ))}
      </g>
      {burst !== undefined ? (
        <g key={burst} className="wf-goal-ring__burst">
          {Array.from({ length: 8 }, (_, i) => (
            <circle key={i} cx="60" cy="60" r="2.6" />
          ))}
        </g>
      ) : null}
    </svg>
  );
}
