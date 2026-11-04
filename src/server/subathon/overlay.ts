import 'server-only';
import type { Subathon } from '@/generated/prisma/client';
import { db } from '../db';
import { subathonEvent, type OverlayEvent } from '../overlay/events';
import { publishOverlay } from '../overlay/publish';

/** A finished subathon keeps showing "Fim!" on the widget for this long, then the widget empties. */
const ENDED_VISIBLE_MS = 6 * 3_600_000;

/** What the "subathon" widget shows now: the open subathon, or one that ended recently. */
export async function subathonSnapshot(now = new Date()): Promise<OverlayEvent | null> {
  const s = await db().subathon.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!s) return null;
  if (s.status === 'ENDED' && (s.endedAt?.getTime() ?? 0) < now.getTime() - ENDED_VISIBLE_MS) {
    return null;
  }
  return subathonEvent(s, null, now);
}

/** After a commit that changed the timer: the new state, plus what moved it (for the "+5:00" pop). */
export async function publishSubathon(
  s: Subathon,
  last: { id: string; seconds: number; label: string | null } | null,
): Promise<void> {
  await publishOverlay('subathon', subathonEvent(s, last));
}
