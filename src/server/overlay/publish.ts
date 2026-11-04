import 'server-only';
import { logger } from '../log';
import { redis } from '../redis';
import type { OverlayEvent, Widget } from './events';

/** Redis channel of one overlay widget (the SSE stream subscribes to it). */
export const overlayChannel = (w: Widget) => `wf:overlay:${w}`;

/** Publish an already-validated overlay event. Best effort: overlays resync on reconnect. */
export async function publishOverlay(w: Widget, e: OverlayEvent): Promise<void> {
  try {
    await redis().publish(overlayChannel(w), JSON.stringify(e));
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'overlay publish failed');
  }
}
