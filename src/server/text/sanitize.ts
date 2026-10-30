import 'server-only';

/**
 * Plain-text sanitiser for everything people type that other people see (catalog texts written
 * by moderators, later reviews and sponsor messages — 05 §8, 11 §9). Output is still rendered
 * only as React text nodes; this removes what could deceive or break layouts:
 *
 *  • Unicode NFC; CR/LF normalised; tabs → spaces
 *  • C0/C1 control characters, bidi overrides/isolates (Trojan-Source style reordering),
 *    zero-width/invisible characters, BOM, soft hyphen, line/paragraph separators
 *  • the zero-width joiner, except inside an emoji sequence (👨‍👩‍👧 stays one family)
 *  • whitespace runs collapsed; at most one blank line in multi-line text; trimmed
 *
 * It never truncates: callers validate the sanitised length (`codePointLength`) and answer 422.
 */

/** Character class from code-point ranges (kept numeric so no invisible character is in source). */
function charClass(ranges: readonly (readonly [number, number])[]): RegExp {
  const hex = (n: number) => `\\u{${n.toString(16)}}`;
  return new RegExp(
    `[${ranges.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join('')}]`,
    'gu',
  );
}

const CONTROLS = charClass([
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
]);
const INVISIBLE = charClass([
  [0xad, 0xad], // soft hyphen
  [0x34f, 0x34f], // combining grapheme joiner
  [0x61c, 0x61c], // Arabic letter mark
  [0x115f, 0x1160], // Hangul fillers
  [0x17b4, 0x17b5],
  [0x180e, 0x180e], // Mongolian vowel separator
  [0x200b, 0x200c], // zero-width space / non-joiner
  [0x200e, 0x200f], // LRM, RLM
  [0x2028, 0x2029], // line / paragraph separator
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x206f], // word joiner, invisible operators, bidi isolates
  [0x3164, 0x3164],
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb], // interlinear annotation
  [0xe0000, 0xe007f], // tag characters
]);
const SPACES = charClass([
  [0x20, 0x20],
  [0xa0, 0xa0],
  [0x2000, 0x200a],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
]);

/** A ZWJ survives only between an emoji (optionally with VS16 / skin tone) and another emoji. */
const STRAY_ZWJ =
  // eslint-disable-next-line no-misleading-character-class -- VS16 and skin tones are listed on purpose, each on its own
  /(?<![\p{Extended_Pictographic}\u{FE0F}\u{1F3FB}-\u{1F3FF}])\u{200D}|\u{200D}(?!\p{Extended_Pictographic})/gu;

export function plainText(input: string, opts: { multiline?: boolean } = {}): string {
  let s = input.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  s = s.replace(CONTROLS, '').replace(INVISIBLE, '').replace(STRAY_ZWJ, '');
  if (!opts.multiline) s = s.replace(/\n+/g, ' ');
  s = s
    .split('\n')
    .map((line) => line.replace(new RegExp(`${SPACES.source}+`, 'gu'), ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * Links in a text (05 §8: more than 2 hold a review for moderation). URLs stay plain text — they
 * are never linkified — so this only counts: `scheme://…`, `www.…` and bare host names ending in
 * a common TLD (`site.com/x`, `loja.com.br`). Linear-time patterns only (no nested quantifiers).
 */
const LINK_PATTERNS = [
  /\b[a-z][a-z0-9+.-]{1,15}:\/\/\S+/giu,
  /\bwww\.\S+/giu,
  /\b[a-z0-9][a-z0-9-]{0,62}\.(?:com|net|org|info|biz|io|co|me|tv|gg|app|dev|xyz|site|online|store|shop|link|click|top|live|br)(?:\.[a-z]{2})?(?![a-z0-9-])\S*/giu,
] as const;

export function countLinks(text: string): number {
  let rest = text;
  let n = 0;
  for (const re of LINK_PATTERNS) {
    rest = rest.replace(re, () => {
      n++;
      return ' ';
    });
  }
  return n;
}

/** Length as Postgres char_length() counts it (code points, not UTF-16 units). */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
