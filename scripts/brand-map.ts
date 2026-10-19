/**
 * Asset inventory → ASCII slugs (docs/phase-0/06-design-tokens.md §1, "Colour → file map").
 * All brand assets are monochrome; the numeric suffix of each original file encodes its colour.
 * The pipeline verifies every SVG's fill against this map, so a wrong entry fails the build.
 */
export const PALETTE = {
  ink: '#1b1225',
  plum: '#4f3d72',
  violet: '#736bb2',
  lavender: '#a99de0',
  lilac: '#e5dded',
} as const;

export type BrandColour = keyof typeof PALETTE;
export const COLOURS = Object.keys(PALETTE) as BrandColour[];

type Group = {
  /** slug prefix, e.g. "mascote-1" → mascote-1-ink.svg */
  slug: string;
  svgDir: string;
  pngDir: string;
  /** original basename without extension, per colour (order: ink, plum, violet, lavender, lilac) */
  files: Record<BrandColour, string>;
  /** generate an inline React component (SVGR)? Large patterns are used as CSS backgrounds only. */
  component: boolean;
};

const by = (
  slug: string,
  svgDir: string,
  pngDir: string,
  prefix: string,
  [ink, plum, violet, lavender, lilac]: [number, number, number, number, number],
  component = true,
): Group => ({
  slug,
  svgDir,
  pngDir,
  component,
  files: {
    ink: `${prefix}${ink}`,
    plum: `${prefix}${plum}`,
    violet: `${prefix}${violet}`,
    lavender: `${prefix}${lavender}`,
    lilac: `${prefix}${lilac}`,
  },
});

const A = ['SVG - ASSETS', 'PNG - ASSETS'] as const;
const M = ['SVG - MASCOTE', 'PNG - MASCOTE'] as const;
const P = ['SVG - PATTERNS', 'PNG - PATTERNS'] as const;

export const GROUPS: Group[] = [
  by('frame-1', ...A, 'FRAME 1-', [7, 3, 11, 15, 19]),
  by('frame-2', ...A, 'FRAME 2-', [6, 2, 10, 14, 18]),
  by('ponto', ...A, 'PONTO-', [5, 1, 9, 13, 17]),
  by('rabinho', ...A, 'RABINHO-', [8, 4, 12, 16, 20]),
  by('mascote-1', ...M, 'VERSÃO 1-', [15, 20, 11, 9, 3]),
  by('mascote-2', ...M, 'VERSÃO 2-', [14, 18, 12, 10, 4]),
  by('mascote-3', ...M, 'VERSÃO 3-', [16, 19, 6, 8, 2]),
  by('mascote-4', ...M, 'VERSÃO 4-', [13, 17, 5, 7, 1]),
  by('padrao-1', ...P, 'PADRÃO 1-', [10, 7, 1, 4, 13], false),
  by('padrao-2', ...P, 'PADRÃO 2-', [11, 8, 2, 5, 14], false),
  by('padrao-3', ...P, 'PADRÃO 3-', [12, 9, 3, 6, 15], false),
];

/** PNG-only icons (no SVG exists): the blackletter monogram with the PONTO diamond as full stop. */
export const ICONS: { source: string; slug: string }[] = [
  { source: 'PNG - ICONS/favicon.png', slug: 'favicon-lilac' },
  { source: 'PNG - ICONS/SUBMARCA-11.png', slug: 'submarca-ink' },
  { source: 'PNG - ICONS/SUBMARCA-12.png', slug: 'submarca-plum' },
  { source: 'PNG - ICONS/SUBMARCA-13.png', slug: 'submarca-violet' },
  { source: 'PNG - ICONS/SUBMARCA-14.png', slug: 'submarca-lavender' },
];

export type SvgEntry = {
  slug: string;
  colour: BrandColour;
  source: string;
  pngSource: string;
  component: boolean;
};

export function svgEntries(): SvgEntry[] {
  return GROUPS.flatMap((g) =>
    COLOURS.map((colour) => ({
      slug: `${g.slug}-${colour}`,
      colour,
      source: `${g.svgDir}/${g.files[colour]}.svg`,
      pngSource: `${g.pngDir}/${g.files[colour]}.png`,
      component: g.component,
    })),
  );
}

/** "mascote-1-ink" → "Mascote1Ink" */
export function componentName(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
