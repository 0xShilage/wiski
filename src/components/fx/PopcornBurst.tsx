/**
 * Popcorn burst (2026-11-10): kernels and a few sparks fly out from the middle of the parent once
 * (CSS keyframes; each piece's direction comes from its position in `.wf-pop`, since inline
 * styles are not allowed). Decorative: hidden from assistive tech, and not shown at all with
 * reduced motion. Give it a new `key` to play it again. The parent needs `position: relative`.
 */
export function PopcornBurst({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  const n = size === 'lg' ? 16 : 7;
  return (
    <span className={`wf-pop wf-pop--${size}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="wf-pop__p">
          {i % 4 === 3 ? <Spark /> : <Kernel />}
        </span>
      ))}
    </span>
  );
}

function Kernel() {
  return (
    <svg viewBox="0 0 20 20" focusable="false">
      <g className="wf-pop__kernel">
        <circle cx="7" cy="11" r="5" />
        <circle cx="12.5" cy="7.5" r="5" />
        <circle cx="13" cy="13" r="4.5" />
      </g>
    </svg>
  );
}

function Spark() {
  return (
    <svg viewBox="0 0 20 20" focusable="false">
      <path
        className="wf-pop__spark"
        d="M10 1l2.2 6.8L19 10l-6.8 2.2L10 19l-2.2-6.8L1 10l6.8-2.2z"
      />
    </svg>
  );
}
