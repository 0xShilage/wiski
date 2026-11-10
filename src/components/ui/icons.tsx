/** Small re-drawn UI icons (design §5: the Figma vectors couldn't be fetched). Decorative. */
type P = { className?: string };
const base = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
};

export const IconPlay = ({ className }: P) => (
  <svg {...base} className={className} fill="currentColor" stroke="none">
    <path d="M7 4.5v15l12-7.5z" />
  </svg>
);
export const IconChevronLeft = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const IconChevronRight = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);
export const IconClose = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconCheck = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const IconFilm = ({ className }: P) => (
  <svg {...base} className={className}>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M7.5 4v16M16.5 4v16M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" />
  </svg>
);
export const IconTv = ({ className }: P) => (
  <svg {...base} className={className}>
    <rect x="3" y="7" width="18" height="12" rx="2" />
    <path d="M8.5 3l3.5 4 3.5-4" />
  </svg>
);
export const IconLayers = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M12 4l9 5-9 5-9-5z" />
    <path d="M3 14l9 5 9-5" />
  </svg>
);
/** Animes (2026-11-09): a sparkle. */
export const IconSparkles = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
);
/** Jogos (2026-11-09): a gamepad. */
export const IconGamepad = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M7 8h10a4 4 0 0 1 4 4v2.5a2.5 2.5 0 0 1-4.6 1.4L15 14H9l-1.4 1.9A2.5 2.5 0 0 1 3 14.5V12a4 4 0 0 1 4-4z" />
    <path d="M7.5 11v2M6.5 12h2M15.5 11.5h.01M17.5 12.5h.01" />
  </svg>
);
/** Fila (2026-11-09): a numbered list. */
export const IconQueue = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4 5.5l1-.5v3M4 11.5h2l-2 2h2M4 17h1.5a.75.75 0 0 1 0 1.5H4.5h1a.75.75 0 0 1 0 1.5H4" />
  </svg>
);
export const IconCalendar = ({ className }: P) => (
  <svg {...base} className={className}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);
export const IconStar = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.8l6-.7z" />
  </svg>
);
export const IconUser = ({ className }: P) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="8.5" r="4" />
    <path d="M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
  </svg>
);
export const IconPlus = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
/** Phase 6: Links (two chain links), Sugestões (a light bulb), Mais (three dots). */
export const IconLink = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </svg>
);
export const IconBulb = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2v.5h5v-.5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" />
  </svg>
);
export const IconWheel = ({ className }: P) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 5v16M4 13h16M6.3 7.3l11.4 11.4M17.7 7.3L6.3 18.7" />
    <path d="M10 2.5h4L12 5z" fill="currentColor" />
  </svg>
);
export const IconHeart = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </svg>
);
export const IconSparkle = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" />
  </svg>
);
export const IconTrophy = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" />
  </svg>
);
export const IconMore = ({ className }: P) => (
  <svg {...base} className={className} fill="currentColor" stroke="none">
    <circle cx="5.5" cy="12" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="18.5" cy="12" r="1.9" />
  </svg>
);
/** Assistidos (2026-11-01): an eye. */
export const IconEye = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const IconSearch = ({ className }: P) => (
  <svg {...base} className={className} strokeWidth={2.2}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5L20.5 20.5" />
  </svg>
);
