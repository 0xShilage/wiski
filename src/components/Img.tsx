/* eslint-disable @next/next/no-img-element -- this IS the image wrapper */
import { getImageProps, type ImageProps } from 'next/image';
import { cn } from '@/lib/cn';

type Props = Omit<ImageProps, 'style' | 'placeholder' | 'blurDataURL'> & { className?: string };

/**
 * `next/image` without its inline `style` attribute (05 §7 CSP gotcha #1): the strict CSP has no
 * 'unsafe-inline' for styles, so SSR must not emit style="…". The styles next/image would inline
 * (`color: transparent`, and the absolute positioning for `fill`) are applied as classes instead.
 */
export function Img({ className, fill, alt, ...rest }: Props) {
  const { props } = getImageProps({ ...rest, alt, ...(fill ? { fill } : {}) });
  const { style: _dropped, className: _ignored, ...imgProps } = props;
  return (
    <img
      {...imgProps}
      alt={alt}
      className={cn('text-transparent', fill && 'absolute inset-0 size-full', className)}
    />
  );
}
