import 'server-only';
import { redis } from '../redis';

/** Redis channel that wakes the worker's webhook loop right after a delivery is stored. */
export const WAKE_CHANNEL = 'wf:jobs';

export async function wakeWorker(): Promise<void> {
  try {
    await redis().publish(WAKE_CHANNEL, 'webhook');
  } catch {
    // the worker polls every 2 s anyway
  }
}
