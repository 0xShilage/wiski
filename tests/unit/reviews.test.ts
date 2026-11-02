import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatAverage } from '@/lib/reviews/types';
import { decodeCursor, encodeCursor } from '@/server/reviews/cursor';
import { codePointLength, countLinks, plainText } from '@/server/text/sanitize';
import { KEEP_CORPUS, XSS_CORPUS } from '../support/xss-corpus';

/** Code points the sanitiser must never let through (05 §8). */
const FORBIDDEN =
  // eslint-disable-next-line no-control-regex -- the point is to detect control characters
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF\u{E0000}-\u{E007F}]/u;

describe('review text sanitiser — XSS corpus', () => {
  it.each(XSS_CORPUS.map((p) => [p]))('%j comes out as inert plain text', (payload) => {
    const out = plainText(payload, { multiline: true });
    expect(out).not.toMatch(FORBIDDEN);
    expect(plainText(out, { multiline: true })).toBe(out); // idempotent
    expect(codePointLength(out)).toBeLessThanOrEqual(codePointLength(payload));
    // markup isn't rewritten: it stays visible text (React escapes it on render)
    if (payload.includes('<script>')) expect(out).toContain('<script>');
  });

  it('removes the deception characters', () => {
    expect(plainText('nota 5\u202E01 = aton')).toBe('nota 501 = aton');
    expect(plainText('ad\u200Bmin\u200C\u200D diz')).toBe('admin diz');
    expect(plainText('texto\u0000com\u0007controles')).toBe('textocomcontroles');
    expect(plainText('linha\u2028separada', { multiline: true })).toBe('linhaseparada');
    expect(plainText('\uFEFFcomeça')).toBe('começa');
  });

  it.each(KEEP_CORPUS.map((t) => [t]))('keeps legitimate text %j', (text) => {
    expect(plainText(text, { multiline: true })).toBe(text.normalize('NFC'));
  });

  it('keeps the ZWJ only inside emoji sequences', () => {
    const family = '👨\u200D👩\u200D👧';
    expect(plainText(family)).toBe(family);
    expect(plainText('👍🏽\u200D🔥')).toBe('👍🏽\u200D🔥');
    expect(plainText('a\u200Db')).toBe('ab');
    expect(plainText('👍\u200D')).toBe('👍');
    expect(plainText('\u200D👍')).toBe('👍');
  });

  it('keeps paragraphs but at most one blank line', () => {
    expect(plainText('a\n\n\n\nb\n c ', { multiline: true })).toBe('a\n\nb\nc');
  });

  it('property: output never contains forbidden code points and is a fixpoint', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (s) => {
        const out = plainText(s, { multiline: true });
        expect(out).not.toMatch(FORBIDDEN);
        expect(plainText(out, { multiline: true })).toBe(out);
        expect(out).toBe(out.trim());
      }),
      { numRuns: 2000 },
    );
  });

  it('counts astral characters as one (like Postgres char_length)', () => {
    expect(codePointLength('🎬'.repeat(2000))).toBe(2000);
  });
});

describe('link counting (> 2 links hold a review)', () => {
  it.each([
    ['sem links aqui, nota 4.5 e 3.0', 0],
    ['veja https://exemplo.com/x', 1],
    ['www.exemplo.org e http://a.b', 2],
    ['loja.com.br, site.net/oferta e promo.xyz', 3],
    ['hxxp://disfarcado conta; javascript:alert(1) não', 1],
    ['ftp://a.b/c https://d.e f.com', 3],
    ['e-mail fulano@gmail.com', 1],
    ['O Sr. Smith vs. Dr. Who: 10/10', 0],
  ])('%j → %i', (text, n) => {
    expect(countLinks(text)).toBe(n);
  });

  it('is linear on hostile input', () => {
    const t = Date.now();
    countLinks(`${'a'.repeat(60)}.`.repeat(2000) + 'x'.repeat(10_000));
    expect(Date.now() - t).toBeLessThan(500);
  });
});

describe('review cursors', () => {
  const k = {
    createdAt: new Date('2026-10-30T12:00:00.000Z'),
    id: '019a3a00-0000-7000-8000-000000000001',
  };

  it('round-trips', () => {
    expect(decodeCursor(encodeCursor(k), false)).toEqual(k);
    expect(decodeCursor(encodeCursor({ ...k, likeCount: 7 }), true)).toEqual({
      ...k,
      likeCount: 7,
    });
    expect(decodeCursor(undefined, false)).toBeNull();
  });

  it.each([
    'bm90LWpzb24',
    Buffer.from('{"c":"ontem","i":"x"}').toString('base64url'),
    Buffer.from(
      '{"c":"2026-10-30T12:00:00.000Z","i":"019a3a00-0000-7000-8000-000000000001","x":1}',
    ).toString('base64url'),
    Buffer.from(
      '{"c":"2026-10-30T12:00:00.000Z","i":"019a3a00-0000-7000-8000-000000000001","l":-1}',
    ).toString('base64url'),
  ])('rejects a tampered cursor %#', (raw) => {
    expect(() => decodeCursor(raw, false)).toThrow();
  });

  it('a "top" cursor needs the like count', () => {
    expect(() => decodeCursor(encodeCursor(k), true)).toThrow();
  });
});

describe('formatting', () => {
  it('formats the average in pt-BR', () => {
    expect(formatAverage(43)).toBe('4,3');
    expect(formatAverage(50)).toBe('5,0');
  });
});
