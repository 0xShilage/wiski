import type { Season } from '@/lib/season';

/**
 * The little seasonal piece next to the header logo (2026-11-10): a Santa hat, a jack-o'-lantern,
 * two balloons or a heart. Plain SVG shapes (no <style>, the CSP has no 'unsafe-inline');
 * decoration only.
 */
export function SeasonBadge({ season }: { season: Season }) {
  return (
    <span className={`wf-season-badge wf-season-badge--${season}`} aria-hidden="true">
      {season === 'natal' ? (
        <Hat />
      ) : season === 'halloween' ? (
        <Pumpkin />
      ) : season === 'namorados' ? (
        <Heart />
      ) : (
        <Balloons />
      )}
    </span>
  );
}

function Heart() {
  return (
    <svg viewBox="0 0 48 48" focusable="false">
      <path
        d="M24 41 C9 31 5 23 5 17 C5 11 9 7 15 7 C19 7 22 9 24 13 C26 9 29 7 33 7 C39 7 43 11 43 17 C43 23 39 31 24 41 Z"
        fill="#ff5e8a"
      />
      <path d="M24 13 C22 9 19 7 15 7 C9 7 5 11 5 17 C5 23 9 31 24 41 Z" fill="#ff86a9" />
      <ellipse cx="15" cy="17" rx="3" ry="4.5" fill="#fff" opacity="0.5" />
    </svg>
  );
}

function Hat() {
  return (
    <svg viewBox="0 0 48 48" focusable="false">
      <path
        d="M8 36 C12 20 22 8 34 10 C40 11 43 17 42 24 L38 23 C37 18 34 16 30 17 C24 19 20 28 20 36 Z"
        fill="#e63950"
      />
      <path d="M30 17 C34 16 37 18 38 23 L42 24 C43 17 40 11 34 10 Z" fill="#b8243b" />
      <rect x="5" y="33" width="20" height="8" rx="4" fill="#fdf6f0" />
      <circle cx="41" cy="27" r="5" fill="#fdf6f0" />
    </svg>
  );
}

function Pumpkin() {
  return (
    <svg viewBox="0 0 48 48" focusable="false">
      <path d="M23 12 C23 8 25 5 29 4 L30 7 C27 8 26 10 26 12 Z" fill="#5a8f3c" />
      <ellipse cx="15" cy="28" rx="10" ry="14" fill="#e8761c" />
      <ellipse cx="33" cy="28" rx="10" ry="14" fill="#e8761c" />
      <ellipse cx="24" cy="28" rx="10" ry="15" fill="#ff9a3c" />
      <path d="M15 24 L19 20 L21 25 Z M33 24 L29 20 L27 25 Z" fill="#3a1d05" />
      <path
        d="M14 31 Q24 40 34 31 L31 32 L29 35 L26 32 L24 35 L22 32 L19 35 L17 32 Z"
        fill="#3a1d05"
      />
    </svg>
  );
}

function Balloons() {
  return (
    <svg viewBox="0 0 48 48" focusable="false">
      <path
        d="M17 30 Q15 37 19 46 M31 27 Q33 36 28 46"
        fill="none"
        stroke="#e5dded"
        strokeWidth="1.2"
      />
      <ellipse cx="17" cy="19" rx="9" ry="11" fill="#ff7fbf" />
      <path d="M15 30 L17 32 L19 30 Z" fill="#ff7fbf" />
      <ellipse cx="31" cy="16" rx="9" ry="11" fill="#a99de0" />
      <path d="M29 27 L31 29 L33 27 Z" fill="#a99de0" />
      <ellipse cx="14" cy="15" rx="2.2" ry="3.4" fill="#fff" opacity="0.55" />
      <ellipse cx="28" cy="12" rx="2.2" ry="3.4" fill="#fff" opacity="0.55" />
    </svg>
  );
}
