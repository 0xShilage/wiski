/**
 * Críticas como recortes de jornal (2026-11-13): the most-liked review of a title, cut to a
 * clipping — at most `max` characters, ending on a whole word with an ellipsis.
 */
export function clippingExcerpt(body: string, max = 280): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if ([...text].length <= max) return text;
  const cut = [...text].slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  let base = space > max * 0.6 ? cut.slice(0, space) : cut;
  while (base && ' ,;:.!?…—-'.includes(base.at(-1)!)) base = base.slice(0, -1);
  return `${base}…`;
}
