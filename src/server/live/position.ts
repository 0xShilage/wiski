import 'server-only';
import { placeOnSession, type TitleQueueStatus } from '@/lib/queue-position';
import { db } from '../db';
import { queue, sessionWithEntries } from './schedule';

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

  if (entry.sessionId) {
    const s = await sessionWithEntries(entry.sessionId);
    if (!s || (s.status !== 'PLANNED' && s.status !== 'LIVE')) return null;
    const live = s.status === 'LIVE';
    if (entry.status === 'WATCHING' || (live && s.nowItemId === item.id))
      return { kind: 'playing' };
    const place = placeOnSession(
      s.entries.map((e) => ({
        id: e.id,
        runtimeMinutes: e.runtimeMinutes,
        done: e.status === 'COMPLETED' || e.status === 'WATCHED',
      })),
      entry.id,
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
