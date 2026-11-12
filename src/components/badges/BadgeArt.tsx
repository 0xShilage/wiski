import type { Picture } from '@/lib/media';

/**
 * A badge's art (2026-11-12): the animated WebP, or its still first frame for people who asked for
 * less motion (a <source> with the media query — no script). Same-origin /media/ only.
 */
export function BadgeArt({
  picture,
  still,
  name,
  size,
  className = '',
}: {
  picture: Picture | null;
  still: Picture | null;
  name: string;
  size: number;
  className?: string;
}) {
  if (!picture) return <span className={`wf-badge-art wf-badge-art--empty ${className}`} />;
  const sizes = `${size}px`;
  return (
    <picture className={`wf-badge-art ${className}`}>
      {still ? (
        <>
          {still.avif ? (
            <source
              media="(prefers-reduced-motion: reduce)"
              type="image/avif"
              srcSet={still.avif}
              sizes={sizes}
            />
          ) : null}
          <source
            media="(prefers-reduced-motion: reduce)"
            type="image/webp"
            srcSet={still.webp}
            sizes={sizes}
          />
        </>
      ) : null}
      {picture.avif ? <source type="image/avif" srcSet={picture.avif} sizes={sizes} /> : null}
      <source type="image/webp" srcSet={picture.webp} sizes={sizes} />
      <img
        src={picture.fallback}
        alt={`Emblema ${name}`}
        width={picture.width}
        height={picture.height}
        decoding="async"
        loading="lazy"
      />
    </picture>
  );
}
