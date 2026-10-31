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
