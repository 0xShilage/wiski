import { IconLink } from '@/components/ui/icons';
import { PLATFORM_PATHS } from './platform-icons.generated';

type P = { platform: string | null; className?: string };

const svg = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  focusable: 'false' as const,
};
const outline = {
  ...svg,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Amazon wishlist: a gift box (Amazon's logo is not in any free icon set). */
const Gift = ({ className }: { className?: string | undefined }) => (
  <svg {...outline} className={className}>
    <path d="M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    <path d="M3 7h18v4H3zM12 7v14" />
    <path d="M12 7c-1.5-3.5-5.5-4-5.5-1.5S10 7 12 7zM12 7c1.5-3.5 5.5-4 5.5-1.5S14 7 12 7z" />
  </svg>
);

/** Cinefy: a clapperboard (no official glyph available). */
const Clapper = ({ className }: { className?: string | undefined }) => (
  <svg {...outline} className={className}>
    <path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    <path d="M3.6 9.6 19.4 5.4l-.9-3.2L2.7 6.4z" />
    <path d="M7.4 5.4l2.4 3M12.2 4.1l2.4 3" />
  </svg>
);

/**
 * The icon on a Links button (2026-11-01): the platform's own glyph when the link's host is a
 * known platform, a generic drawing for Amazon and Cinefy, the link icon for any other site.
 * Decorative — the button's text already names it.
 */
export function PlatformIcon({ platform, className }: P) {
  if (platform === 'Amazon') return <Gift className={className} />;
  if (platform === 'Cinefy') return <Clapper className={className} />;
  const d = platform ? PLATFORM_PATHS[platform] : undefined;
  if (!d) return <IconLink {...(className ? { className } : {})} />;
  return (
    <svg {...svg} className={className} fill="currentColor">
      <path d={d} />
    </svg>
  );
}
