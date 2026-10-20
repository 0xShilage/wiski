import { encode } from 'uqr';

/**
 * QR code for the Pix "copia e cola" text, drawn by us as one SVG path (no images from the
 * provider, no `data:` URL, no inline styles — CSP). Drawing it from the same text the buyer can
 * copy guarantees the two always match. ECC level M + a 4-module quiet zone (ISO/IEC 18004).
 */
export function qrPath(text: string): { size: number; d: string } {
  const qr = encode(text, { ecc: 'M', border: 4 });
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    const row = qr.data[y]!;
    let x = 0;
    while (x < qr.size) {
      if (!row[x]) {
        x++;
        continue;
      }
      // One horizontal run per segment keeps the path short.
      let end = x;
      while (end < qr.size && row[end]) end++;
      parts.push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  }
  return { size: qr.size, d: parts.join('') };
}
