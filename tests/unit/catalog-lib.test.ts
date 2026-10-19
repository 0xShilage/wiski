import { describe, expect, it } from 'vitest';
import {
  formatBRL,
  formatRuntime,
  franchiseGoalCents,
  moviePriceCents,
  percentFunded,
  seriesGoalCents,
} from '@/lib/catalog/pricing';
import { slugify } from '@/lib/catalog/slug';
import { parseYoutubeId, trailerEmbedUrl } from '@/lib/catalog/youtube';
import { pictureFrom } from '@/lib/media';
import { sniffImage } from '@/server/media/sniff';
import { codePointLength, plainText } from '@/server/text/sanitize';

describe('catalog money (11 §2, 04 §3)', () => {
  it.each([
    [1, 2000],
    [115, 2000],
    [130, 2000],
    [131, 2100],
    [172, 6200],
    [360, 25000],
  ])('movie %i min → %i cents', (min, cents) => expect(moviePriceCents(min)).toBe(cents));
  it('rejects runtimes outside 1..360', () => {
    for (const r of [0, 361, 1.5, Number.NaN]) expect(() => moviePriceCents(r)).toThrow(RangeError);
  });
  it('series goal = R$ 100 × seasons; franchise goal = Σ movie prices', () => {
    expect(seriesGoalCents(3)).toBe(30000);
    expect(franchiseGoalCents([{ runtimeMinutes: 101 }, { runtimeMinutes: 142 }])).toBe(
      2000 + 3200,
    );
    expect(() => franchiseGoalCents([])).toThrow();
  });
  it('formats', () => {
    expect(formatBRL(2000)).toBe('R$ 20,00');
    expect(formatBRL(186000)).toBe('R$ 1.860,00');
    expect(formatRuntime(115)).toBe('1 h 55 min');
    expect(formatRuntime(120)).toBe('2 h');
    expect(formatRuntime(45)).toBe('45 min');
    expect(percentFunded(18600, 30000)).toBe(62);
    expect(percentFunded(29999, 30000)).toBe(99); // never 100 % before complete
    expect(percentFunded(40000, 30000)).toBe(100);
  });
});

describe('YouTube links (11 §6)', () => {
  it.each([
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('%s → %s', (input, id) => expect(parseYoutubeId(input)).toBe(id));
  it.each([
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://user:pw@youtube.com/watch?v=dQw4w9WgXcQ',
    // eslint-disable-next-line no-script-url -- hostile input under test
    'javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXc',
    'https://youtube.com/watch?v=dQw4w9WgXcQ"onerror',
    'https://youtu.be/../../x',
    '',
  ])('rejects %s', (input) => expect(parseYoutubeId(input)).toBeNull());
  it('embeds only the privacy-enhanced host with a validated id', () => {
    expect(trailerEmbedUrl('dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0',
    );
    expect(() => trailerEmbedUrl('x"><script>')).toThrow();
  });
});

describe('slugs', () => {
  it.each([
    ['A Noite do Esquilo', 'a-noite-do-esquilo'],
    ['Crônicas do Bosque', 'cronicas-do-bosque'],
    ['  Saga Rabinho — 4 filmes!! ', 'saga-rabinho-4-filmes'],
    ['¿¿¿', 'titulo'],
  ])('%s → %s', (t, s) => expect(slugify(t)).toBe(s));
  it('stays within the DB limit', () => {
    expect(slugify('palavra '.repeat(40)).length).toBeLessThanOrEqual(72);
  });
});

describe('plain-text sanitiser', () => {
  it('removes bidi overrides, invisible and control characters; normalises whitespace', () => {
    const rlo = String.fromCodePoint(0x202e);
    const zw = String.fromCodePoint(0x200b);
    const bell = String.fromCodePoint(7);
    expect(plainText(`  A${rlo} Noite${zw}  do\tEsquilo${bell} `)).toBe('A Noite do Esquilo');
    expect(plainText('l1\r\n\r\n\r\n\r\nl2', { multiline: true })).toBe('l1\n\nl2');
    expect(plainText('l1\nl2')).toBe('l1 l2');
    expect(plainText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>'); // React escapes
    expect(codePointLength('ação😀')).toBe(5);
  });
});

describe('image sniffing (11 §5)', () => {
  const bytes = (...b: (number | string)[]) => {
    const out: number[] = [];
    for (const x of b) {
      if (typeof x === 'string') out.push(...Buffer.from(x));
      else out.push(x);
    }
    while (out.length < 32) out.push(0);
    return new Uint8Array(out);
  };
  it('detects by bytes only', () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(sniffImage(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(sniffImage(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('webp');
    expect(sniffImage(bytes(0, 0, 0, 24, 'ftypavif', 0, 0, 0, 0, 'mif1miaf'))).toBe('avif');
    expect(sniffImage(bytes(0, 0, 0, 24, 'ftypmif1', 0, 0, 0, 0, 'mif1avif'))).toBe('avif');
    expect(sniffImage(bytes(0, 0, 0, 24, 'ftypheic', 0, 0, 0, 0, 'mif1heic'))).toBeNull();
    expect(sniffImage(bytes('GIF89a'))).toBeNull();
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImage(bytes(0xff, 0xd8))).toBeNull(); // too short / truncated marker
  });
});

describe('pictures', () => {
  it('builds srcsets only from well-formed same-origin /media paths', () => {
    const h = 'a'.repeat(32);
    const p = pictureFrom({
      width: 960,
      height: 1440,
      variants: [
        { w: 480, h: 720, format: 'webp', path: `/media/${h}-480.webp`, bytes: 1 },
        { w: 240, h: 360, format: 'webp', path: `/media/${h}-240.webp`, bytes: 1 },
        { w: 240, h: 360, format: 'avif', path: `/media/${h}-240.avif`, bytes: 1 },
        { w: 960, h: 1440, format: 'webp', path: 'https://evil.example/x.webp', bytes: 1 },
        { w: 960, h: 1440, format: 'webp', path: '/media/../../etc/passwd', bytes: 1 },
      ],
    });
    expect(p).toEqual({
      width: 960,
      height: 1440,
      avif: `/media/${h}-240.avif 240w`,
      webp: `/media/${h}-240.webp 240w, /media/${h}-480.webp 480w`,
      fallback: `/media/${h}-480.webp`,
    });
    expect(pictureFrom(null)).toBeNull();
  });
});
