/**
 * A tiny parser for the legal text's markup (src/content/legal): headings, paragraphs, lists,
 * bold, bare links and {placeholders}. It returns plain data; the page renders text nodes only
 * (no HTML strings, so nothing in the text can become markup).
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; v: Inline[] }
  | { t: 'a'; href: string }
  | { t: 'blank'; key: string; v: string | null };

export type Block =
  | { kind: 'h2'; id: string; text: string }
  | { kind: 'h3'; id: string; text: string }
  | { kind: 'p'; inlines: Inline[] }
  | { kind: 'ul'; items: Inline[][] };

/** "## 6.1. Google — …" → "secao-6-1" (stable anchors: the numbers, not the words). */
export function sectionId(heading: string): string {
  const num = /^(\d+(?:\.\d+)*)\./.exec(heading)?.[1];
  if (num) return `secao-${num.replaceAll('.', '-')}`;
  return heading
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const LINK = /^https:\/\/[^\s<>]+$/;

function plain(s: string, values: Record<string, string | null>): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(/\{([a-z]+)\}|<([^<>\s]+)>/g)) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    if (m[1] !== undefined && Object.hasOwn(values, m[1])) {
      out.push({ t: 'blank', key: m[1], v: values[m[1]] ?? null });
    } else if (m[2] !== undefined && LINK.test(m[2])) {
      out.push({ t: 'a', href: m[2] });
    } else {
      out.push({ t: 'text', v: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

export function parseInline(s: string, values: Record<string, string | null> = {}): Inline[] {
  const out: Inline[] = [];
  const parts = s.split('**');
  // an odd count of "**" leaves the last one literal
  const closed = parts.length % 2 === 1 ? parts.length : parts.length - 1;
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1 && i < closed) out.push({ t: 'b', v: plain(part, values) });
    else out.push(...plain(i >= closed ? `**${part}` : part, values));
  });
  return out;
}

export function parseLegal(text: string, values: Record<string, string | null> = {}): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.trim().split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim());
    const first = lines[0] ?? '';
    const h = /^(#{2,3}) (.+)$/.exec(first);
    if (h && lines.length === 1) {
      const t = h[2]!.trim();
      blocks.push(
        h[1] === '##'
          ? { kind: 'h2', id: sectionId(t), text: t }
          : { kind: 'h3', id: sectionId(t), text: t },
      );
    } else if (lines.every((l) => l.startsWith('- '))) {
      const items = lines.map((l) => parseInline(l.slice(2), values));
      const prev = blocks.at(-1);
      // pandoc puts a blank line between loose list items: merge them back into one list
      if (prev?.kind === 'ul') prev.items.push(...items);
      else blocks.push({ kind: 'ul', items });
    } else {
      blocks.push({ kind: 'p', inlines: parseInline(lines.join(' '), values) });
    }
  }
  return blocks;
}
