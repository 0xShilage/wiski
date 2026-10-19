/** Shared class recipes (no inline styles anywhere — CSP). */
const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-pill px-5 py-2.5 text-sm font-semibold transition-colors duration-200 ease-smooth disabled:cursor-not-allowed disabled:opacity-60';

export const button = {
  primary: `${base} bg-accent text-accent-fg hover:bg-lilac`,
  secondary: `${base} border border-border text-fg hover:bg-surface-2`,
  ghost: `${base} text-fg-muted hover:bg-surface-2 hover:text-fg`,
  danger: `${base} border border-danger/60 text-danger hover:bg-danger/10`,
} as const;

export const card = 'rounded-lg border border-border/60 bg-surface-1 p-5 shadow-card sm:p-6';
export const container = 'mx-auto w-full max-w-[72rem] px-4 md:px-6';
export const heading = {
  display: 'font-display text-display uppercase tracking-wide text-lilac',
  h1: 'font-display text-h1 uppercase tracking-wide text-lilac',
  h2: 'font-display text-h2 uppercase tracking-wide text-lilac',
  h3: 'text-h3 font-semibold text-lilac',
} as const;
export const field =
  'min-h-11 w-full rounded-sm border border-border bg-surface-2 px-3 py-2 text-base text-fg placeholder:text-fg-muted/70 focus-visible:border-accent';
