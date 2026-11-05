import 'server-only';
import { placeOnSession, type TitleQueueStatus } from '@/lib/queue-position';
import { db } from '../db';
import { entryDone, queue, sessionWithEntries } from './schedule';

/**
 * A title page's "Na fila" card (2026-11-04): only facts the public schedule already shows —
 * which live it's booked on, its place among that live's titles, the queue order of paid titles
 * still waiting for a date. Read-only: never changes an order or a session.
 */
export async function titleQueueStatus(
  item: { id: string; kind: 'MOVIE' | 'SERIES' | 'FRANCHISE' },
  now = new Date(),
): Promise<TitleQueueStatus | null> {
  const entry =
    item.kind === 'MOVIE'
      ? await db().order.findFirst({
          where: {
            itemId: item.id,
            kind: 'MOVIE',
            status: { in: ['PAID', 'SCHEDULED', 'WATCHING'] },
          },
          select: { id: true, status: true, sessionId: true },
        })
      : await db().campaign.findFirst({
          where: { itemId: item.id, status: { in: ['FUNDED', 'SCHEDULED'] } },
          select: { id: true, status: true, sessionId: true },
        });
  if (!entry) return null;

  // a funded series/franchise watched in parts (2026-11-04): the next part on a live, if booked
  if (item.kind !== 'MOVIE' && entry.status === 'FUNDED') {
    const part = await db().liveSegment.findFirst({
      where: {
        campaignId: entry.id,
        status: { in: ['PLAYING', 'SCHEDULED'] },
        session: { status: { in: ['PLANNED', 'LIVE'] } },
      },
      orderBy: [{ session: { startsAt: 'asc' } }, { createdAt: 'asc' }],
      select: { id: true, status: true, label: true, sessionId: true },
    });
    if (part) {
      if (part.status === 'PLAYING') return { kind: 'playing', part: part.label };
      const placed = await placeIn(part.sessionId, part.id, now);
      if (placed) return { ...placed, part: part.label };
    }
  }

  if (entry.sessionId) {
    const s = await sessionWithEntries(entry.sessionId);
    if (!s || (s.status !== 'PLANNED' && s.status !== 'LIVE')) return null;
    if (entry.status === 'WATCHING' || (s.status === 'LIVE' && s.nowItemId === item.id))
      return { kind: 'playing' };
    return placeIn(entry.sessionId, entry.id, now);
  }

  const [waiting, next] = await Promise.all([
    queue(),
    db().streamSession.findFirst({
      where: { status: 'PLANNED', startsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      select: { startsAt: true },
    }),
  ]);
  const index = waiting.findIndex((e) => e.id === entry.id);
  if (index < 0) return null;
  return {
    kind: 'queued',
    position: index + 1,
    total: waiting.length,
    nextLiveAt: next?.startsAt.toISOString() ?? null,
  };
}

/** The entry's place among what is still to play on its session, with a rough start time. */
async function placeIn(
  sessionId: string,
  entryId: string,
  now: Date,
): Promise<Extract<TitleQueueStatus, { kind: 'scheduled' }> | null> {
  const s = await sessionWithEntries(sessionId);
  if (!s || (s.status !== 'PLANNED' && s.status !== 'LIVE')) return null;
  const live = s.status === 'LIVE';
  const place = placeOnSession(
    s.entries.map((e) => ({ id: e.id, runtimeMinutes: e.runtimeMinutes, done: entryDone(e) })),
    entryId,
    s.startsAt,
    now,
    live,
  );
  if (!place) return null;
  return {
    kind: 'scheduled',
    sessionStartsAt: s.startsAt.toISOString(),
    live,
    position: place.position,
    total: place.total,
    estimatedAt: place.estimatedAt.toISOString(),
  };
}
