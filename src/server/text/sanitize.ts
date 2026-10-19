import 'server-only';

/**
 * Plain-text sanitiser for everything people type that other people see (catalog texts written
 * by moderators, later reviews and sponsor messages — 05 §8, 11 §9). Output is still rendered
 * only as React text nodes; this removes what could deceive or break layouts:
 *
 *  • Unicode NFC; CR/LF normalised; tabs → spaces
 *  • C0/C1 control characters, bidi overrides/isolates (Trojan-Source style reordering),
 *    zero-width/invisible characters, BOM, soft hyphen, line/paragraph separators
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
  [0x200b, 0x200f], // zero-width space/non-joiner/joiner, LRM, RLM
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

export function plainText(input: string, opts: { multiline?: boolean } = {}): string {
  let s = input.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  s = s.replace(CONTROLS, '').replace(INVISIBLE, '');
  if (!opts.multiline) s = s.replace(/\n+/g, ' ');
  s = s
    .split('\n')
    .map((line) => line.replace(new RegExp(`${SPACES.source}+`, 'gu'), ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Length as Postgres char_length() counts it (code points, not UTF-16 units). */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
