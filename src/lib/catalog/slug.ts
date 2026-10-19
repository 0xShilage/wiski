/** "A Noite do Esquilo" → "a-noite-do-esquilo" (ASCII, ≤ 72 chars; the DB CHECK allows 80). */
const COMBINING_MARKS = /\p{M}/gu;

export function slugify(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .split(/[^a-z0-9]/)
    .filter(Boolean)
    .join('-')
    .slice(0, 72);
  return (s.endsWith('-') ? s.slice(0, -1) : s) || 'titulo';
}
