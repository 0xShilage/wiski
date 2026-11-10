/**
 * Text that goes on stream (2026-11-09): the "Novo patrocínio" overlay shows, the voice reads and
 * the chat bot posts what viewers typed — names and messages go live without approval. Before
 * that, links are dropped (a URL on stream is a free ad or a scam) and a short list of swear
 * words and slurs is masked. Not a moderation system: moderators can still hide a text in
 * Pedidos; this keeps the obvious out of the live in the meantime.
 */

/** Lower-case, no accents, common digit-for-letter swaps undone: "P0rr4" → "porra". */
function fold(word: string): string {
  return word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/(.)\1+/g, '$1'); // "porraaa" → "pora" (matched against folded words below)
}

/**
 * Folded the same way (repeated letters collapsed). Whole words only, and only words with no
 * innocent meaning in a message about a movie ("pau", "veado" or "macaco" stay: Bambi, pica-pau,
 * Planeta dos Macacos, Piranha).
 */
const BLOCKED = new Set(
  [
    'porra',
    'caralho',
    'caralhos',
    'krl',
    'crl',
    'puta',
    'putas',
    'puto',
    'putaria',
    'merda',
    'merdas',
    'bosta',
    'buceta',
    'boceta',
    'xoxota',
    'xereca',
    'piroca',
    'cu',
    'cuzao',
    'foda',
    'fodas',
    'foder',
    'fodase',
    'fudido',
    'fodido',
    'fdp',
    'pqp',
    'vsf',
    'tnc',
    'arrombado',
    'arrombada',
    'viado',
    'traveco',
    'sapatao',
    'vadia',
    'vagabunda',
    'vagabundo',
    'retardado',
    'retardada',
    'fuck',
    'fucking',
    'shit',
    'bitch',
    'cunt',
    'nigger',
    'nigga',
    'faggot',
    'retard',
  ].map(fold),
);

/** A URL or a bare domain ("site.com/x", "www.x", "x.gg"), also with spaces around the dot. */
const LINK =
  /(?:https?:\/\/|www\.)\S+|\b[\p{L}\p{N}-]{2,}\s?(?:\.|\(dot\)|\[dot\]|ponto)\s?(?:com|net|org|br|gg|tv|io|me|co|xyz|app|link|ly|info|site|online|store|shop)\b\S*/giu;

const WORD = /[\p{L}\p{N}@]+/gu;

export type StreamText = { shown: string; spoken: string };

/**
 * `shown`: links removed, blocked words as "***". `spoken`: the same with blocked words left out
 * (a voice reading "asterisco" is worse). null when nothing is left.
 */
export function streamSafe(raw: string | null | undefined): StreamText | null {
  if (!raw) return null;
  const noLinks = raw.replace(LINK, ' ').replace(/\s+/g, ' ').trim();
  if (!noLinks) return null;
  let blocked = false;
  const mask = (bad: string) => (w: string) => (BLOCKED.has(fold(w)) ? ((blocked = true), bad) : w);
  const shown = noLinks.replace(WORD, mask('***'));
  const spoken = noLinks
    .replace(WORD, mask(''))
    .replace(/\s+/g, ' ')
    .replace(/ ([,.!?])/g, '$1')
    .trim();
  if (!/[\p{L}\p{N}]/u.test(spoken)) return blocked ? { shown, spoken: '' } : null;
  return { shown, spoken };
}

/** A name for the stream: "@fulano" stays, a blocked or link-only name becomes null. */
export function streamSafeName(raw: string | null | undefined): string | null {
  const t = streamSafe(raw);
  if (!t || t.shown.includes('***')) return null;
  return t.shown;
}

/**
 * What the chat bot posts must never start like a chat command ("/ban", ".timeout", "!cmd"):
 * those characters are stripped from the start of every line.
 */
export function chatSafe(line: string): string {
  return line.replace(/^[\s/.!\\]+/, '').slice(0, 450);
}
