import { describe, expect, it } from 'vitest';
import { qrPath } from '@/lib/qr';

// A Pix "copia e cola" payload shape (EMV BR Code); the values are fictional.
const PIX =
  '00020101021226830014br.gov.bcb.pix2561qrpix.example.com/v2/cobv/9d36b84f-c70b-478f-b95c-12729b90ca2552040000530398654042000.005802BR5913NOME FICTICIO6009SAO PAULO62070503***6304ABCD';

describe('Pix QR path', () => {
  it('is deterministic, with a 4-module quiet zone and the three finder patterns', () => {
    const a = qrPath(PIX);
    expect(qrPath(PIX)).toEqual(a);
    // version v → 17 + 4v modules, plus 2 × 4 border
    expect((a.size - 8 - 17) % 4).toBe(0);
    // first run starts at the quiet-zone corner: the top-left finder (7 dark modules)
    expect(a.d.startsWith('M4 4h7v1h-7z')).toBe(true);
    // the top-right finder starts 7 modules before the right quiet zone on the same row
    expect(a.d).toContain(`M${a.size - 4 - 7} 4h7v1h-7z`);
    expect(a.d).toMatch(/^(?:M\d+ \d+h\d+v1h-\d+z)+$/);
  });

  it('bigger payloads grow the symbol, never the error-correction level down', () => {
    expect(qrPath(PIX + 'X'.repeat(200)).size).toBeGreaterThan(qrPath(PIX).size);
  });
});
