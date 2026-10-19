/**
 * Processed image variants (11 §5) and the data the <MediaPicture> component needs.
 * Client-safe: no file system access, only same-origin /media/ paths.
 */
export type MediaFormat = 'avif' | 'webp';
export type MediaVariant = {
  w: number;
  h: number;
  format: MediaFormat;
  path: string;
  bytes: number;
};

export type Picture = {
  width: number;
  height: number;
  avif: string; // srcset
  webp: string; // srcset
  fallback: string; // a mid-size WebP for <img src>
};

/** Fixed output widths per role (11 §5). */
export const MEDIA_WIDTHS = {
  POSTER: [240, 480, 960],
  BACKDROP: [960, 1440, 1920, 2560],
  LOGO: [480, 960],
} as const;

const SAFE_PATH = /^\/media\/[0-9a-f]{32}-\d{2,4}\.(?:avif|webp)$/;

export function pictureFrom(
  asset: { width: number; height: number; variants: unknown } | null | undefined,
): Picture | null {
  if (!asset || !Array.isArray(asset.variants)) return null;
  const vs = (asset.variants as MediaVariant[]).filter(
    (v) =>
      v &&
      SAFE_PATH.test(v.path) &&
      Number.isInteger(v.w) &&
      (v.format === 'avif' || v.format === 'webp'),
  );
  const set = (f: MediaFormat) =>
    vs
      .filter((v) => v.format === f)
      .sort((a, b) => a.w - b.w)
      .map((v) => `${v.path} ${v.w}w`)
      .join(', ');
  const webp = vs.filter((v) => v.format === 'webp').sort((a, b) => a.w - b.w);
  if (!webp.length) return null;
  const mid = webp[Math.min(1, webp.length - 1)]!;
  return {
    width: asset.width,
    height: asset.height,
    avif: set('avif'),
    webp: set('webp'),
    fallback: mid.path,
  };
}
