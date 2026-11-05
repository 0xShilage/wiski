import 'server-only';
import { logger } from '../log';
import { redis } from '../redis';
import { type OverlayEvent, overlayEventSchema, type Widget } from './events';

/** Redis channel of one overlay widget (the SSE stream subscribes to it). */
export const overlayChannel = (w: Widget) => `wf:overlay:${w}`;

/**
 * "Novo patrocínio" alerts kept for a few minutes (2026-11-05), so an overlay that was
 * reconnecting when a payment came in still shows it. The other widgets don't need this: each
 * new stream starts with a fresh snapshot of what they show.
 */
const RECENT_KEY = 'wf:overlay:patrocinio:recent';
const RECENT_MAX = 20;
export const ALERT_REPLAY_MS = 5 * 60_000;

/** Publish an already-validated overlay event. Best effort: overlays resync on reconnect. */
export async function publishOverlay(w: Widget, e: OverlayEvent): Promise<void> {
  const raw = JSON.stringify(e);
  try {
    if (w === 'patrocinio') {
      await redis()
        .multi()
        .lpush(RECENT_KEY, raw)
        .ltrim(RECENT_KEY, 0, RECENT_MAX - 1)
        .pexpire(RECENT_KEY, ALERT_REPLAY_MS * 2)
        .exec();
    }
    await redis().publish(overlayChannel(w), raw);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'overlay publish failed');
  }
}

/**
 * Alerts the overlay missed: newer than `since` (the server time of the last thing that stream
 * received) and at most ALERT_REPLAY_MS old, oldest first, as SSE frames. Re-validated on read.
 */
export async function missedAlerts(since: string | undefined, now = new Date()): Promise<string[]> {
  if (!since) return [];
  const from = Math.max(Date.parse(since), now.getTime() - ALERT_REPLAY_MS);
  if (!Number.isFinite(from)) return [];
  let rows: string[] = [];
  try {
    rows = await redis().lrange(RECENT_KEY, 0, RECENT_MAX - 1);
  } catch {
    return [];
  }
  const frames: string[] = [];
  for (const raw of rows.reverse()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const ev = overlayEventSchema.safeParse(parsed);
    if (!ev.success || ev.data.type !== 'new-sponsorship') continue;
    if (Date.parse(ev.data.at) > from) frames.push(`data: ${JSON.stringify(ev.data)}\n\n`);
  }
  return frames;
}
