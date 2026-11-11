import type { AgendaEntry } from './types';

/** How the Fila is ordered on the agenda board. */
export type QueueSort = 'fila' | 'az' | 'za';

/** pt-BR, ignoring case and accents, numbers as numbers (so "2" sorts before "10"). */
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

const titleOf = (e: AgendaEntry) => e.item?.title ?? e.segment?.label ?? '';

/**
 * The Fila in the chosen order (2026-11-10). 'fila' keeps the server order (Topo da fila,
 * Prioridade, then by payment date); 'az' / 'za' sort by title, ignoring case and accents.
 * Always returns a new array and never mutates the input.
 */
export function sortQueue(entries: AgendaEntry[], mode: QueueSort): AgendaEntry[] {
  if (mode === 'fila') return entries;
  const dir = mode === 'za' ? -1 : 1;
  return [...entries].sort((a, b) => dir * collator.compare(titleOf(a), titleOf(b)));
}
