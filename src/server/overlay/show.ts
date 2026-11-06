import 'server-only';
import { logger } from '../log';
import { redis } from '../redis';
import { showEvent } from './events';
import { publishOverlay } from './publish';
import { nowPlayingSnapshot, queueSnapshot } from './state';

/**
 * "Agora assistindo" and "Próximos da fila" pop in (2026-11-06): they show for two minutes when
 * what they show changes, and again whenever someone types !agora or !fila in chat. The command
 * marks the widget visible in Redis for that long, so a source that (re)connects meanwhile also
 * shows it for the time left.
 */
export const POP_WIDGETS = ['agora', 'fila'] as const;
export type PopWidget = (typeof POP_WIDGETS)[number];
export const SHOW_SECONDS = 120;

const key = (w: PopWidget) => `wf:overlay:show:${w}`;

export async function showOverlay(w: PopWidget, seconds = SHOW_SECONDS): Promise<void> {
  try {
    await redis().set(key(w), '1', 'PX', seconds * 1000);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'overlay show failed');
  }
  await publishOverlay(w, showEvent(seconds));
}

/** For a stream that opens while the widget is showing: an SSE frame with the seconds left. */
export async function pendingShow(w: PopWidget): Promise<string[]> {
  let ms = -2;
  try {
    ms = await redis().pttl(key(w));
  } catch {
    return [];
  }
  if (ms < 1_000) return [];
  return [`data: ${JSON.stringify(showEvent(Math.ceil(ms / 1000)))}\n\n`];
}

/** The chatbot's one-line answer (titles only — never a sponsor's name or message). */
export async function chatAnswer(w: PopWidget): Promise<string> {
  if (w === 'agora') {
    const e = await nowPlayingSnapshot();
    return e.type === 'now-playing' && e.title
      ? `🎬 Agora na live: ${e.title}`
      : 'Nada passando agora na live.';
  }
  const e = await queueSnapshot();
  if (e.type !== 'queue' || !e.items.length) return 'A fila está vazia por enquanto.';
  const next = e.items.slice(0, 3).map((i, n) => `${n + 1}. ${i.title}`);
  return `📋 Próximos na live: ${next.join(' · ')}`;
}
