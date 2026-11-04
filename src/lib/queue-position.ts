/**
 * Where a title stands on its way to the live (2026-11-04): shown on its page. Client-safe types
 * and the pure estimate; the server side is src/server/live/position.ts.
 */
export type TitleQueueStatus =
  /** on screen right now */
  | { kind: 'playing' }
  /** booked on a live: its place among that live's titles and a rough start time */
  | {
      kind: 'scheduled';
      sessionStartsAt: string;
      live: boolean;
      position: number;
      total: number;
      /** start of the live + the runtimes of the titles before it (null when unknown) */
      estimatedAt: string | null;
    }
  /** paid / funded, waiting for a date */
  | { kind: 'queued'; position: number; total: number; nextLiveAt: string | null };

export type EstimateEntry = { id: string; runtimeMinutes: number; done: boolean };

/**
 * The title's place among the titles still to play on a live, and when it should roughly start:
 * the live's start (or now, once it's on and running late) plus the runtimes of the ones before it.
 */
export function placeOnSession(
  entries: EstimateEntry[],
  targetId: string,
  start: Date,
  now: Date,
  live: boolean,
): { position: number; total: number; estimatedAt: Date } | null {
  const pending = entries.filter((e) => !e.done);
  const index = pending.findIndex((e) => e.id === targetId);
  if (index < 0) return null;
  const base = live ? new Date(Math.max(now.getTime(), start.getTime())) : start;
  const ahead = pending.slice(0, index).reduce((m, e) => m + Math.max(0, e.runtimeMinutes), 0);
  return {
    position: index + 1,
    total: pending.length,
    estimatedAt: new Date(base.getTime() + ahead * 60_000),
  };
}

/** "2d 03h", "5h 12min", "8 min", "agora" */
export function countdownText(to: Date, now: Date): string {
  const ms = to.getTime() - now.getTime();
  if (ms <= 60_000) return 'agora';
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
  return `${m} min`;
}
