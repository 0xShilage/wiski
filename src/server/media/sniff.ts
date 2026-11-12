import 'server-only';

/**
 * Image type detection from the FILE BYTES (11 §5) — never from the name or Content-Type.
 * Allow-list: JPEG, PNG, WebP, AVIF, and GIF (accepted by the pipeline for badges only,
 * 2026-11-12). Everything else (SVG, HEIC, HTML, PDF, video, …) → null.
 */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif';

const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, end));

export function sniffImage(head: Uint8Array): ImageFormat | null {
  if (head.length < 16) return null;
  // JPEG: SOI + marker
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  // PNG: fixed 8-byte signature
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((v, i) => head[i] === v)) return 'png';
  // GIF: "GIF87a" or "GIF89a"
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') return 'gif';
  // WebP: RIFF <size> WEBP
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'webp';
  // AVIF: ISO-BMFF `ftyp` box whose major or compatible brands include avif/avis.
  if (ascii(head, 4, 8) === 'ftyp') {
    const size = ((head[0]! << 24) | (head[1]! << 16) | (head[2]! << 8) | head[3]!) >>> 0;
    if (size < 16 || size > 256 || size > head.length) return null;
    const brands = [ascii(head, 8, 12)];
    for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(head, i, i + 4));
    if (brands.includes('avif') || brands.includes('avis')) return 'avif';
  }
  return null;
}

/** Bytes needed by sniffImage (largest ftyp box we look at). */
export const SNIFF_BYTES = 256;
