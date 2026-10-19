import type { Picture } from '@/lib/media';

type Props = {
  picture: Picture | null;
  alt: string;
  /** the `sizes` attribute: how wide the image is rendered */
  sizes: string;
  className?: string;
  /** the LCP image (hero backdrop) */
  priority?: boolean;
};

/**
 * <picture> with AVIF + WebP srcsets from a MediaAsset (11 §5). Same-origin /media/ URLs only;
 * width/height attributes reserve the space (no layout shift). No inline styles (CSP).
 */
export function MediaPicture({ picture, alt, sizes, className, priority = false }: Props) {
  if (!picture) return null;
  return (
    <picture>
      {picture.avif ? <source type="image/avif" srcSet={picture.avif} sizes={sizes} /> : null}
      <source type="image/webp" srcSet={picture.webp} sizes={sizes} />
      <img
        src={picture.fallback}
        alt={alt}
        width={picture.width}
        height={picture.height}
        className={className}
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        {...(priority ? { fetchPriority: 'high' as const } : {})}
      />
    </picture>
  );
}
