import { cn } from '@/lib/cn';
import { LogoWiskiInk, LogoWiskiLavender, LogoWiskiLilac } from './generated';

const BY_COLOUR = {
  lilac: LogoWiskiLilac,
  ink: LogoWiskiInk,
  lavender: LogoWiskiLavender,
} as const;

type Props = {
  /** lilac on dark backgrounds (default), ink on light ones (06 §8). */
  colour?: keyof typeof BY_COLOUR;
  className?: string;
  /** Accessible name. Omit when the surrounding link/heading already names it. */
  label?: string;
};

/** "Wiski" wordmark: Black Rockie glyph outlines (scripts/logo.ts). Minimum height 24 px. */
export function Logo({ colour = 'lilac', className, label }: Props) {
  const Svg = BY_COLOUR[colour];
  return (
    <Svg
      className={cn('aspect-logo h-8 w-auto min-h-6', className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
