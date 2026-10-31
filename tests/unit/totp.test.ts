import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  base32Decode,
  base32Encode,
  hotp,
  matchStep,
  normaliseRecoveryCode,
  qrFor,
  stepAt,
  totpAt,
} from '@/server/auth/totp';

/** RFC 4226 appendix D / RFC 6238 appendix B (SHA-1 secret "12345678901234567890"). */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP / TOTP (RFC 4226, RFC 6238)', () => {
  it('matches the RFC 4226 HOTP test values', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expected.forEach((code, i) => expect(hotp(RFC_SECRET, BigInt(i))).toBe(code));
  });

  it('matches the RFC 6238 SHA-1 TOTP values (last 6 of the 8 digits)', () => {
    const cases: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [t, code8] of cases) {
      expect(totpAt(RFC_SECRET, new Date(t * 1000))).toBe(code8.slice(2));
      expect(hotp(RFC_SECRET, stepAt(new Date(t * 1000)), 8)).toBe(code8);
    }
  });

  it('accepts ±1 step of clock drift and nothing further', () => {
    const now = new Date(1_700_000_000_000);
    const step = stepAt(now);
    for (const d of [-1, 0, 1]) {
      const code = hotp(RFC_SECRET, step + BigInt(d));
      expect(matchStep(RFC_SECRET, code, now)).toBe(step + BigInt(d));
    }
    for (const d of [-3, -2, 2, 3]) {
      const code = hotp(RFC_SECRET, step + BigInt(d));
      // a far code can collide with a near one by chance (1 in a million) — not with this secret
      expect(matchStep(RFC_SECRET, code, now)).toBeNull();
    }
  });

  it('refuses anything that is not exactly 6 digits', () => {
    const now = new Date();
    const good = totpAt(RFC_SECRET, now);
    for (const bad of [
      '',
      '12345',
      '1234567',
      `${good} `,
      ` ${good}`,
      'abcdef',
      '１２３４５６',
      `${good.slice(0, 5)}x`,
    ]) {
      expect(matchStep(RFC_SECRET, bad, now)).toBeNull();
    }
  });
});

describe('base32 (RFC 4648)', () => {
  it('known vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb oi').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow();
  });

  it('round-trips any 20-byte secret', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 20, maxLength: 20 }), (b) => {
        const enc = base32Encode(b);
        expect(enc).toMatch(/^[A-Z2-7]{32}$/);
        expect([...base32Decode(enc)]).toEqual([...b]);
      }),
    );
  });
});

describe('recovery codes and QR', () => {
  it('normalises case, spaces and the dash; rejects ambiguous or wrong-length codes', () => {
    expect(normaliseRecoveryCode('abcde-23456')).toBe('ABCDE23456');
    expect(normaliseRecoveryCode(' ABCDE 23456 ')).toBe('ABCDE23456');
    for (const bad of [
      'ABCDE-2345',
      'ABCDE-234567',
      'ABCD0-23456',
      'ABCDO-23456',
      'ABCDI-23456',
      'ABCD1-23456',
      '<script>',
    ]) {
      expect(normaliseRecoveryCode(bad)).toBeNull();
    }
  });

  it('draws the QR code as a plain SVG path (only M/h/v/z commands and numbers)', () => {
    const qr = qrFor('otpauth://totp/Wiski:%40mod?secret=MZXW6YTBOI&issuer=Wiski');
    expect(qr.size).toBeGreaterThan(20);
    expect(qr.path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
  });
});
