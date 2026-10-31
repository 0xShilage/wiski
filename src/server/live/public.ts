import 'server-only';
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
