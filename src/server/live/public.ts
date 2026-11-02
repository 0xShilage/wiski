import 'server-only';
import { type Picture, pictureFrom } from '@/lib/media';
import { db } from '../db';
import { sessionsWithEntries } from './schedule';

/**
 * "Próximos na live" (11 §3, O7): the next lives and their titles, for everyone. Only public
 * facts: start time, the note, titles, approved sponsor names (or none = "Anônimo").
 */
export type PublicSession = {
  id: string;
  startsAt: string;
  live: boolean;
  note: string | null;
  now: string | null;
  titles: {
    title: string;
    kind: 'MOVIE' | 'SERIES' | 'FRANCHISE';
    slug: string;
    sponsor: string | null;
    jumped: boolean;
    done: boolean;
  }[];
};

export async function publicSchedule(now = new Date(), take = 4): Promise<PublicSession[]> {
  const sessions = await sessionsWithEntries({
    from: new Date(now.getTime() - 6 * 3_600_000),
    statuses: ['PLANNED', 'LIVE'],
    take,
  });
  return sessions.map((s) => ({
    id: s.id,
    startsAt: s.startsAt.toISOString(),
    live: s.status === 'LIVE',
    note: s.publicNote,
    now: s.nowItem?.title ?? null,
    titles: s.entries.map((e) => ({
      title: e.item.title,
      kind: e.item.kind,
      slug: e.item.slug,
      sponsor: e.sponsor,
      jumped: e.tier !== null,
      done: e.status === 'COMPLETED' || e.status === 'WATCHED',
    })),
  }));
}

/**
 * Cronograma (2026-10-31): every title already booked on an upcoming live (movies, funded series
 * and franchises), grouped by day in São Paulo, plus what was watched on lives that ended in the
 * last two days. Paid titles without a date are not listed. Same public facts as above.
 */
export const CRONOGRAMA_PAST_MS = 2 * 86_400_000;

export type CronogramaTitle = PublicSession['titles'][number] & { poster: Picture | null };
export type CronogramaDay = {
  date: string;
  sessions: (Omit<PublicSession, 'titles'> & { past: boolean; titles: CronogramaTitle[] })[];
};

const dayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export async function cronograma(now = new Date()): Promise<CronogramaDay[]> {
  const [upcoming, ended] = await Promise.all([
    sessionsWithEntries({
      from: new Date(now.getTime() - 6 * 3_600_000),
      statuses: ['PLANNED', 'LIVE'],
      take: 60,
    }),
    sessionsWithEntries({
      // a live that started up to a day before the window can still have ended inside it
      from: new Date(now.getTime() - CRONOGRAMA_PAST_MS - 86_400_000),
      to: now,
      statuses: ['DONE'],
      take: 30,
    }),
  ]);
  const cutoff = now.getTime() - CRONOGRAMA_PAST_MS;
  const rows = [
    ...ended
      .filter((s) => (s.endsAt ?? s.startsAt).getTime() >= cutoff)
      .map((s) => ({
        s,
        past: true,
        entries: s.entries.filter((e) => e.status === 'COMPLETED' || e.status === 'WATCHED'),
      }))
      .filter((r) => r.entries.length > 0),
    ...upcoming.map((s) => ({ s, past: false, entries: s.entries })),
  ].sort((a, b) => a.s.startsAt.getTime() - b.s.startsAt.getTime());

  // posters (2026-11-01): one query for every title on the page
  const ids = [...new Set(rows.flatMap((r) => r.entries.map((e) => e.item.id)))];
  const posters = new Map(
    (ids.length
      ? await db().catalogItem.findMany({
          where: { id: { in: ids } },
          select: { id: true, poster: { select: { width: true, height: true, variants: true } } },
        })
      : []
    ).map((i) => [i.id, pictureFrom(i.poster)]),
  );

  const days = new Map<string, CronogramaDay>();
  for (const { s, past, entries } of rows) {
    const date = dayKey.format(s.startsAt);
    if (!days.has(date)) days.set(date, { date, sessions: [] });
    days.get(date)!.sessions.push({
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      live: s.status === 'LIVE',
      note: s.publicNote,
      now: s.nowItem?.title ?? null,
      past,
      titles: entries.map((e) => ({
        title: e.item.title,
        kind: e.item.kind,
        slug: e.item.slug,
        sponsor: e.sponsor,
        jumped: e.tier !== null,
        done: e.status === 'COMPLETED' || e.status === 'WATCHED',
        poster: posters.get(e.item.id) ?? null,
      })),
    });
  }
  return [...days.values()];
}
