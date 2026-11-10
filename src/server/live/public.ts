import 'server-only';
import { type Picture, pictureFrom } from '@/lib/media';
import { db } from '../db';
import { entryDone, type QueueEntry, sessionsWithEntries } from './schedule';

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
  titles: PublicTitle[];
};

/**
 * One line of a live: a movie, a series/franchise (whole, or a part of it — `part` says which
 * episodes or film, 2026-11-04), or a custom event (`kind` EVENT, no title page).
 */
export type PublicTitle = {
  title: string;
  part: string | null;
  note: string | null;
  kind: 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'EVENT';
  slug: string | null;
  sponsor: string | null;
  jumped: boolean;
  done: boolean;
  playing: boolean;
};

function publicTitle(e: QueueEntry, nowItemId: string | null, live: boolean): PublicTitle {
  const g = e.segment;
  return {
    title: e.item?.title ?? g?.label ?? '',
    part: g?.kind === 'PART' ? g.label : null,
    note: g?.note ?? null,
    kind: e.item?.kind ?? 'EVENT',
    slug: e.item?.slug ?? null,
    sponsor: e.sponsor,
    jumped: e.tier !== null,
    done: entryDone(e),
    playing:
      live &&
      (e.status === 'PLAYING' ||
        e.status === 'WATCHING' ||
        (!g && e.kind === 'CAMPAIGN' && e.item?.id === nowItemId)),
  };
}

/** What the live shows right now: a playing segment, else the session's title. */
function nowLabel(s: {
  playing: QueueEntry | null;
  nowItem: { title: string } | null;
}): string | null {
  const g = s.playing?.segment;
  if (g)
    return g.kind === 'PART' && s.playing?.item ? `${s.playing.item.title} · ${g.label}` : g.label;
  return s.nowItem?.title ?? null;
}

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
    now: s.status === 'LIVE' ? nowLabel(s) : null,
    titles: s.entries.map((e) => publicTitle(e, s.nowItemId, s.status === 'LIVE')),
  }));
}

/**
 * Cronograma (2026-10-31): every title already booked on an upcoming live (movies, funded series
 * and franchises), grouped by day in São Paulo, plus what was watched on lives that ended in the
 * last two days (parts and events included). Paid titles without a date are not listed. Same
 * public facts as above.
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
        entries: s.entries.filter(entryDone),
      }))
      .filter((r) => r.entries.length > 0),
    ...upcoming.map((s) => ({ s, past: false, entries: s.entries })),
  ].sort((a, b) => a.s.startsAt.getTime() - b.s.startsAt.getTime());

  // posters (2026-11-01): one query for every title on the page
  const ids = [
    ...new Set(rows.flatMap((r) => r.entries.flatMap((e) => (e.item ? [e.item.id] : [])))),
  ];
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
      now: s.status === 'LIVE' ? nowLabel(s) : null,
      past,
      titles: entries.map((e) => ({
        ...publicTitle(e, s.nowItemId, s.status === 'LIVE'),
        // a custom event shows its own poster when it has one (2026-11-09)
        poster: e.item ? (posters.get(e.item.id) ?? null) : (e.segment?.poster ?? null),
      })),
    });
  }
  return [...days.values()];
}

const whenFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * !proximo (2026-11-09): the next title or event on the agenda, as one chat line. During a live:
 * the first thing on it that isn't done or on screen; otherwise (or when the live has nothing
 * left) the first thing on the next planned live, with its date. Titles only, never a sponsor.
 */
export async function nextUpAnswer(now = new Date()): Promise<string> {
  const sessions = await sessionsWithEntries({
    from: new Date(now.getTime() - 12 * 3_600_000),
    statuses: ['PLANNED', 'LIVE'],
    take: 10,
  });
  const live = sessions.find((s) => s.status === 'LIVE');
  const label = (e: QueueEntry) => {
    const t = publicTitle(e, null, false);
    return t.part ? `${t.title} · ${t.part}` : t.title;
  };
  if (live) {
    const next = live.entries.find(
      (e) =>
        !entryDone(e) &&
        e.status !== 'PLAYING' &&
        e.status !== 'WATCHING' &&
        !(e.item && e.item.id === live.nowItemId && !live.playing?.segment),
    );
    if (next) return `⏭️ Próximo na live: ${label(next)}`;
  }
  const planned = sessions
    .filter((s) => s.status === 'PLANNED' && s.startsAt.getTime() >= now.getTime() - 3_600_000)
    .find((s) => s.entries.some((e) => !entryDone(e)));
  const first = planned?.entries.find((e) => !entryDone(e));
  if (!planned || !first) return 'Nada agendado na agenda da live por enquanto.';
  return `⏭️ Próximo na live: ${label(first)} (${whenFmt.format(planned.startsAt).replace(',', '')})`;
}

/** Is a live session marked "Ao vivo" in Cronograma right now? (home page Twitch block) */
export async function liveNow(): Promise<boolean> {
  const s = await db().streamSession.findFirst({ where: { status: 'LIVE' }, select: { id: true } });
  return s !== null;
}
