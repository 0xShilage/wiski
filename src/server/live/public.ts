import 'server-only';
import { type Picture, pictureFrom } from '@/lib/media';
import { db } from '../db';
import { entryDone, type QueueEntry, sessionsWithEntries } from './schedule';
import { publicSponsor, sponsorSelect } from './sponsor';

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
  kind: 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME' | 'EVENT';
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

/**
 * Fila (2026-11-09): every title already paid and waiting to be watched — sponsored movies and
 * series/franchises with the goal reached. What is on screen first, then what has a date (by
 * date), then the rest in queue order ("Topo da fila", "Prioridade", then by payment).
 */
export type FilaEntry = {
  key: string;
  title: string;
  kind: 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME';
  slug: string;
  year: number | null;
  poster: Picture | null;
  sponsor: string | null;
  jumped: boolean;
  playing: boolean;
  /** the live it is booked on (a series: its next part), else null */
  when: string | null;
  /** series/franchise: parts already watched, e.g. "T1 · E6" */
  lastPart: string | null;
};

const posterSelect = { select: { width: true, height: true, variants: true } } as const;
const filaItemSelect = {
  id: true,
  kind: true,
  slug: true,
  title: true,
  year: true,
  status: true,
  poster: posterSelect,
} as const;
const TIER_ORDER: Record<string, number> = { topo: 0, prioridade: 1 };

export async function publicQueue(): Promise<FilaEntry[]> {
  const [orders, campaigns] = await Promise.all([
    db().order.findMany({
      where: {
        kind: 'MOVIE',
        status: { in: ['PAID', 'SCHEDULED', 'WATCHING'] },
        item: { status: 'SPONSORED' },
      },
      select: {
        id: true,
        status: true,
        paidAt: true,
        queueJumpTierId: true,
        session: { select: { startsAt: true, status: true } },
        item: { select: filaItemSelect },
        ...sponsorSelect,
      },
      take: 200,
    }),
    db().campaign.findMany({
      where: { status: { in: ['FUNDED', 'SCHEDULED'] }, item: { status: 'FUNDED' } },
      select: {
        id: true,
        status: true,
        fundedAt: true,
        session: { select: { startsAt: true, status: true } },
        item: { select: filaItemSelect },
        segments: {
          where: { status: { in: ['SCHEDULED', 'PLAYING', 'DONE'] } },
          orderBy: { createdAt: 'asc' },
          select: {
            label: true,
            status: true,
            session: { select: { startsAt: true, status: true } },
          },
        },
      },
      take: 100,
    }),
  ]);
  type Row = FilaEntry & { rank: number; since: number };
  const rows: Row[] = [];
  for (const o of orders) {
    const playing = o.status === 'WATCHING';
    const when = o.session && o.status === 'SCHEDULED' ? o.session.startsAt.toISOString() : null;
    rows.push({
      key: `o:${o.id}`,
      title: o.item.title,
      kind: o.item.kind,
      slug: o.item.slug,
      year: o.item.year,
      poster: pictureFrom(o.item.poster),
      sponsor: publicSponsor(o),
      jumped: o.queueJumpTierId !== null,
      playing,
      when,
      lastPart: null,
      rank: playing ? -1 : (TIER_ORDER[o.queueJumpTierId ?? ''] ?? 2),
      since: (o.paidAt ?? new Date(0)).getTime(),
    });
  }
  for (const c of campaigns) {
    const playing = c.segments.some((g) => g.status === 'PLAYING' && g.session.status === 'LIVE');
    const next = c.segments.find((g) => g.status === 'SCHEDULED');
    const done = c.segments.filter((g) => g.status === 'DONE');
    const when = next
      ? next.session.startsAt.toISOString()
      : c.status === 'SCHEDULED' && c.session
        ? c.session.startsAt.toISOString()
        : null;
    rows.push({
      key: `c:${c.id}`,
      title: c.item.title,
      kind: c.item.kind,
      slug: c.item.slug,
      year: c.item.year,
      poster: pictureFrom(c.item.poster),
      sponsor: null,
      jumped: false,
      playing,
      when,
      lastPart: done.at(-1)?.label ?? null,
      rank: playing ? -1 : 2,
      since: (c.fundedAt ?? new Date(0)).getTime(),
    });
  }
  rows.sort((a, b) => {
    if (a.playing !== b.playing) return a.playing ? -1 : 1;
    if (a.when && b.when) return a.when.localeCompare(b.when);
    if (a.when || b.when) return a.when ? -1 : 1;
    return a.rank - b.rank || a.since - b.since || a.key.localeCompare(b.key);
  });
  return rows.map(({ rank: _r, since: _s, ...e }) => e);
}

/** Is a live session marked "Ao vivo" in Cronograma right now? (home page Twitch block) */
export async function liveNow(): Promise<boolean> {
  const s = await db().streamSession.findFirst({ where: { status: 'LIVE' }, select: { id: true } });
  return s !== null;
}

/**
 * "AO VIVO" bar (2026-11-10): on every page while a live is "Ao vivo" in Cronograma, with what is
 * on screen ("Duna", "Breaking Bad · T1 · E1-E3", an event's name), or just "ao vivo" when nothing
 * is marked. One indexed lookup when there is no live; the full session only while there is one.
 */
export type LiveStatus = { live: boolean; now: string | null };

export async function liveStatus(now = new Date()): Promise<LiveStatus> {
  if (!(await liveNow())) return { live: false, now: null };
  const [s] = await sessionsWithEntries({ from: now, statuses: ['LIVE'], take: 1 });
  return { live: true, now: s ? nowLabel(s) : null };
}
