/**
 * Dashboard uploads (2026-10-31): images far larger than the site ever shows are shrunk in the
 * browser before upload, so a 4000 × 6000 poster or a 15 MB PNG export just works. The server
 * still decides everything (format sniffing, minimum size, crop, re-encode, 10 MB cap); this
 * only makes the file smaller. Anything the browser can't decode is sent as it is.
 */
export type UploadRole = 'POSTER' | 'BACKDROP' | 'LOGO' | 'PORTRAIT';

/**
 * The largest box worth uploading per role: posters are shown at most 960 px wide, backdrops
 * 2560, logos 960. Posters and backdrops scale to *cover* their box (the server crops to 2:3 /
 * 16:9 afterwards), logos to fit *inside* theirs.
 */
export const UPLOAD_BOX: Record<UploadRole, { w: number; h: number; fit: 'cover' | 'inside' }> = {
  POSTER: { w: 1200, h: 1800, fit: 'cover' },
  BACKDROP: { w: 2560, h: 1440, fit: 'cover' },
  LOGO: { w: 1920, h: 1920, fit: 'inside' },
  PORTRAIT: { w: 960, h: 1280, fit: 'cover' },
};
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Scale factor (≤ 1) that brings `w × h` down to the role's box; 1 = already small enough. */
export function downscaleFactor(role: UploadRole, w: number, h: number): number {
  const box = UPLOAD_BOX[role];
  const s = box.fit === 'cover' ? Math.max(box.w / w, box.h / h) : Math.min(box.w / w, box.h / h);
  return Math.min(1, s);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * The file to upload: the original when it is already within the box and under 10 MB, else a
 * resized JPEG (posters, backdrops) or PNG (logos keep their transparency).
 */
export async function prepareUpload(file: File, role: UploadRole): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // AVIF on an old browser, a broken file…: the server answers properly
  }
  try {
    const factor = downscaleFactor(role, bitmap.width, bitmap.height);
    if (factor === 1 && file.size <= UPLOAD_MAX_BYTES) return file;
    const w = Math.max(1, Math.round(bitmap.width * factor));
    const h = Math.max(1, Math.round(bitmap.height * factor));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out =
      role === 'LOGO'
        ? await toBlob(canvas, 'image/png')
        : await toBlob(canvas, 'image/jpeg', 0.92);
    return out && out.size < file.size ? out : file;
  } finally {
    bitmap.close();
  }
}
