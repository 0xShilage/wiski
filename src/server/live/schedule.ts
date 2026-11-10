import 'server-only';
import type { Prisma, Role } from '@/generated/prisma/client';
import { type Picture, pictureFrom } from '@/lib/media';
import { audit } from '../audit/audit';
import { db } from '../db';
import { pgErrorCode, PG } from '../db-errors';
import { HttpError, Problems } from '../http/problem';
import { publishOrder } from '../realtime/events';
import { plainText, codePointLength } from '../text/sanitize';
import { refreshOverlays } from '../overlay/state';
import { publicMessage, publicSponsor, sponsorSelect } from './sponsor';

/**
 * The live schedule (02 §3, 04 §7, Q15, Q20): stream sessions, the queue of paid movies and funded
 * campaigns, putting them on a session, "Agora assistindo" and "Concluído" (→ the title is watched
 * and its reviews open). Every change is a compare-and-set inside one transaction — the order's
 * `version`, the session's capacity guard and status — and is audited; the order page and the
 * overlays are told after commit.
 *
 * Only this module (and the payment/checkout modules listed in AGENTS.md) moves an order's status.
 */
type Tx = Prisma.TransactionClient;
export type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

const DAY = 86_400_000;
export const RESCHEDULE_MIN_NOTICE_MS = DAY;
export const RESCHEDULE_HORIZON_MS = 60 * DAY;
export const RESCHEDULE_MAX = 2;

export const LiveProblems = {
  changed: () =>
    new HttpError(
      409,
      'SCHEDULE_CHANGED',
      'Outra pessoa mudou isto agora mesmo. Atualize a agenda.',
    ),
  state: (detail: string) => new HttpError(409, 'INVALID_STATE', detail),
  full: () =>
    new HttpError(409, 'SESSION_FULL', 'Não cabe nesta sessão: a duração passa da capacidade.'),
  otherLive: () =>
    new HttpError(409, 'ANOTHER_SESSION_LIVE', 'Já existe uma sessão ao vivo. Encerre-a antes.'),
  capacityBelowBooked: () =>
    new HttpError(
      409,
      'CAPACITY_BELOW_BOOKED',
      'A capacidade não pode ficar menor que o que já está agendado.',
    ),
  noteTooLong: () =>
    Problems.validation([{ path: 'publicNote', message: 'Use no máximo 140 caracteres.' }]),
  rescheduleClosed: (detail: string) => new HttpError(409, 'RESCHEDULE_NOT_ALLOWED', detail),
};

export async function inTx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  try {
    return await db().$transaction(fn, { isolationLevel: 'ReadCommitted', timeout: 10_000 });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const code = pgErrorCode(err);
    if (code === PG.uniqueViolation || (err as { code?: string }).code === 'P2002') {
      throw LiveProblems.otherLive();
    }
    throw err;
  }
}

export function cleanNote(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = plainText(raw);
  if (!s) return null;
  if (codePointLength(s) > 140) throw LiveProblems.noteTooLong();
  return s;
}

// ── sessions ─────────────────────────────────────────────────────────────────

export async function createSession(
  ctx: Ctx,
  input: { startsAt: Date; capacityMinutes: number; publicNote?: string | null | undefined },
) {
  const note = cleanNote(input.publicNote) ?? null;
  return inTx(async (t) => {
    const s = await t.streamSession.create({
      data: { startsAt: input.startsAt, capacityMinutes: input.capacityMinutes, publicNote: note },
    });
    await audit(
      {
        action: 'session.create',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'StreamSession',
        targetId: s.id,
        metadata: { startsAt: s.startsAt.toISOString(), capacityMinutes: s.capacityMinutes },
      },
      t,
    );
    return s;
  });
}

export async function updateSession(
  ctx: Ctx,
  id: string,
  input: {
    expectedVersion: number;
    startsAt?: Date | undefined;
    capacityMinutes?: number | undefined;
    publicNote?: string | null | undefined;
  },
) {
  const note = cleanNote(input.publicNote);
  return inTx(async (t) => {
    const s = await t.streamSession.findUnique({ where: { id } });
    if (!s) throw Problems.notFound();
    if (s.status !== 'PLANNED' && s.status !== 'LIVE') {
      throw LiveProblems.state('Sessões encerradas ou canceladas não mudam mais.');
    }
    if (s.status === 'LIVE' && input.startsAt) {
      throw LiveProblems.state('A sessão já começou: o horário não muda mais.');
    }
    if (input.capacityMinutes !== undefined && input.capacityMinutes < s.bookedMinutes) {
      throw LiveProblems.capacityBelowBooked();
    }
    const res = await t.streamSession.updateMany({
      where: {
        id,
        version: input.expectedVersion,
        status: s.status,
        // a booking committed meanwhile must still fit
        ...(input.capacityMinutes !== undefined
          ? { bookedMinutes: { lte: input.capacityMinutes } }
          : {}),
      },
      data: {
        ...(input.startsAt ? { startsAt: input.startsAt } : {}),
        ...(input.capacityMinutes !== undefined ? { capacityMinutes: input.capacityMinutes } : {}),
        ...(note !== undefined ? { publicNote: note } : {}),
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) throw LiveProblems.changed();
    await audit(
      {
        action: 'session.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'StreamSession',
        targetId: id,
        metadata: {
          fields: [
            ...(input.startsAt ? ['startsAt' as const] : []),
            ...(input.capacityMinutes !== undefined ? ['capacityMinutes' as const] : []),
            ...(note !== undefined ? ['publicNote' as const] : []),
          ],
        },
      },
      t,
    );
    return t.streamSession.findUniqueOrThrow({ where: { id } });
  });
}

export const POSTPONE_MAX_DAYS = 14;

/**
 * "Adiar" (2026-11-10): Iara missed the 10/11 live — move it to 11/11, and (cascade) the 11/11
 * one to 12/11 and so on: every planned session from this one on moves by the same number of
 * days, same time of day (São Paulo has no daylight saving time, so N × 24 h keeps the clock
 * time). What was booked moves with its session; sponsors' own reschedules are not used up.
 * The chosen session is compare-and-set on the version the moderator saw; the others on the
 * version read here, all in one transaction. Only PLANNED sessions move.
 */
export async function postponeSessions(
  ctx: Ctx,
  id: string,
  input: { expectedVersion: number; days: number; cascade: boolean },
  now = new Date(),
) {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > POSTPONE_MAX_DAYS) {
    throw Problems.validation([
      { path: 'days', message: `Adie de 1 a ${POSTPONE_MAX_DAYS} dias.` },
    ]);
  }
  const shift = input.days * DAY;
  const moved = await inTx(async (t) => {
    const s = await t.streamSession.findUnique({ where: { id } });
    if (!s) throw Problems.notFound();
    if (s.status !== 'PLANNED') {
      throw LiveProblems.state('Só sessões planejadas podem ser adiadas.');
    }
    const later = input.cascade
      ? await t.streamSession.findMany({
          where: {
            status: 'PLANNED',
            hiddenAt: null,
            id: { not: id },
            startsAt: { gte: s.startsAt },
          },
          select: { id: true, version: true, startsAt: true },
          orderBy: { startsAt: 'asc' },
        })
      : [];
    const all = [{ id, version: input.expectedVersion, startsAt: s.startsAt }, ...later];
    for (const x of all) {
      const res = await t.streamSession.updateMany({
        where: { id: x.id, version: x.version, status: 'PLANNED' },
        data: { startsAt: new Date(x.startsAt.getTime() + shift), version: { increment: 1 } },
      });
      if (res.count !== 1) throw LiveProblems.changed();
    }
    await audit(
      {
        action: 'session.postpone',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'StreamSession',
        targetId: id,
        metadata: { days: input.days, cascade: input.cascade, sessions: all.length },
      },
      t,
    );
    const orders = await t.order.findMany({
      where: { sessionId: { in: all.map((x) => x.id) }, status: 'SCHEDULED' },
      select: { id: true },
    });
    return { sessions: all.map((x) => x.id), orders: orders.map((o) => o.id) };
  });
  await tellOrders(moved.orders, now);
  await refreshOverlays(['fila']);
  return { moved: moved.sessions.length };
}

/** Take scheduled titles of a session back to the queue (PAID / FUNDED). */
async function returnToQueue(t: Tx, sessionId: string, now: Date): Promise<string[]> {
  const orders = await t.order.findMany({
    where: { sessionId, status: 'SCHEDULED' },
    select: { id: true, publicCode: true },
  });
  if (orders.length) {
    await t.order.updateMany({
      where: { sessionId, status: 'SCHEDULED' },
      data: { status: 'PAID', sessionId: null, scheduledAt: null, version: { increment: 1 } },
    });
  }
  await t.campaign.updateMany({
    where: { sessionId, status: 'SCHEDULED' },
    data: { status: 'FUNDED', sessionId: null, scheduledAt: null, version: { increment: 1 } },
  });
  // segments (2026-11-04): what was on screen when the live ended was shown; what never came
  // up was skipped (a series part simply gets booked again — its campaign never left the queue)
  await t.liveSegment.updateMany({
    where: { sessionId, status: 'PLAYING' },
    data: { status: 'DONE', doneAt: now, version: { increment: 1 } },
  });
  await t.liveSegment.updateMany({
    where: { sessionId, status: 'SCHEDULED' },
    data: { status: 'SKIPPED', version: { increment: 1 } },
  });
  await t.streamSession.update({
    where: { id: sessionId },
    data: { bookedMinutes: await bookedOn(t, sessionId) },
  });
  return orders.map((o) => o.id);
}

/** Minutes a session carries: its movies plus its segments that weren't skipped. */
export async function bookedOn(t: Tx, sessionId: string): Promise<number> {
  const [movies, segments] = await Promise.all([
    t.order.aggregate({
      where: { sessionId, kind: 'MOVIE', status: { in: ['SCHEDULED', 'WATCHING', 'COMPLETED'] } },
      _sum: { runtimeMinutes: true },
    }),
    t.liveSegment.aggregate({
      where: { sessionId, status: { in: ['SCHEDULED', 'PLAYING', 'DONE'] } },
      _sum: { minutes: true },
    }),
  ]);
  return (movies._sum.runtimeMinutes ?? 0) + (segments._sum.minutes ?? 0);
}

/**
 * Whatever is on screen in this session stops being "Agora assistindo": a movie goes back to
 * SCHEDULED in the same session, a playing segment too. Returns the orders that changed.
 */
export async function stopPlaying(t: Tx, sessionId: string): Promise<string[]> {
  const prev = await t.order.findMany({
    where: { sessionId, status: 'WATCHING' },
    select: { id: true },
  });
  await t.order.updateMany({
    where: { sessionId, status: 'WATCHING' },
    data: { status: 'SCHEDULED', version: { increment: 1 } },
  });
  await t.liveSegment.updateMany({
    where: { sessionId, status: 'PLAYING' },
    data: { status: 'SCHEDULED', version: { increment: 1 } },
  });
  return prev.map((p) => p.id);
}

export async function tellOrders(ids: string[], now: Date) {
  if (!ids.length) return;
  const rows = await db().order.findMany({
    where: { id: { in: ids } },
    select: { id: true, publicCode: true, status: true },
  });
  for (const o of rows) {
    await publishOrder(o.id, {
      type: 'status',
      code: o.publicCode,
      status: o.status,
      at: now.toISOString(),
    });
  }
}

export async function startSession(
  ctx: Ctx,
  id: string,
  expectedVersion: number,
  now = new Date(),
) {
  const s = await inTx(async (t) => {
    const res = await t.streamSession.updateMany({
      where: { id, status: 'PLANNED', version: expectedVersion },
      data: { status: 'LIVE', startedAt: now, version: { increment: 1 } },
    });
    if (res.count !== 1) {
      if (!(await t.streamSession.count({ where: { id } }))) throw Problems.notFound();
      throw LiveProblems.changed();
    }
    await audit(
      {
        action: 'session.start',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'StreamSession',
        targetId: id,
        metadata: {},
      },
      t,
    );
    return t.streamSession.findUniqueOrThrow({ where: { id } });
  });
  await refreshOverlays(['agora', 'fila']);
  return s;
}

/** LIVE → DONE. Whatever wasn't watched goes back to the queue; nothing may still be playing. */
export async function endSession(ctx: Ctx, id: string, expectedVersion: number, now = new Date()) {
  let returned: string[] = [];
  const s = await inTx(async (t) => {
    const playing = await t.order.count({ where: { sessionId: id, status: 'WATCHING' } });
    if (playing) {
      throw LiveProblems.state(
        'Marque o filme em exibição como concluído (ou volte-o) antes de encerrar.',
      );
    }
    const res = await t.streamSession.updateMany({
      where: { id, status: 'LIVE', version: expectedVersion },
      data: { status: 'DONE', endsAt: now, nowItemId: null, version: { increment: 1 } },
    });
    if (res.count !== 1) {
      if (!(await t.streamSession.count({ where: { id } }))) throw Problems.notFound();
      throw LiveProblems.changed();
    }
    returned = await returnToQueue(t, id, now);
    await audit(
      {
        action: 'session.end',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'StreamSession',
        targetId: id,
        metadata: { returnedToQueue: returned.length },
      },
      t,
    );
    return t.streamSession.findUniqueOrThrow({ where: { id } });
  });
  await tellOrders(returned, now);
  await refreshOverlays(['agora', 'fila']);
  return s;
}

/** PLANNED → CANCELLED (streamer): everything on it goes back to the queue (04 §7). */
export async function cancelSession(
  ctx: Ctx,
  id: string,
  expectedVersion: number,
  now = new Date(),
) {
  let returned: string[] = [];
  const s = await inTx(async (t) => {
    const res = await t.streamSession.updateMany({
      where: { id, status: 'PLANNED', version: expectedVersion },
      data: { status: 'CANCELLED', cancelledAt: now, version: { increment: 1 } },
    });
    if (res.count !== 1) {
      if (!(await t.streamSession.count({ where: { id } }))) throw Problems.notFound();
      throw LiveProblems.changed();
    }
    returned = await returnToQueue(t, id, now);
    await audit(
      {
        action: 'session.cancel',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'StreamSession',
        targetId: id,
        metadata: { returnedToQueue: returned.length },
      },
      t,
    );
    return t.streamSession.findUniqueOrThrow({ where: { id } });
  });
  await tellOrders(returned, now);
  await refreshOverlays(['fila']);
  return s;
}

/**
 * "Reorganizar" (2026-11-09): the dashboard puts a session's entries in its own order. Every key
 * must be an entry of this session (watched ones included, so the order reads as it happened);
 * entries not listed keep following in queue order.
 */
export async function reorderSession(
  ctx: Ctx,
  id: string,
  expectedVersion: number,
  keys: string[],
) {
  const s = await inTx(async (t) => {
    const row = await t.streamSession.findUnique({ where: { id }, include: sessionInclude });
    if (!row) throw Problems.notFound();
    if (row.version !== expectedVersion) throw LiveProblems.changed();
    if (row.status === 'CANCELLED') throw LiveProblems.state('Esta sessão foi cancelada.');
    const mine = new Set(withEntries(row).entries.map(entryKey));
    if (new Set(keys).size !== keys.length || keys.some((k) => !mine.has(k))) {
      throw LiveProblems.changed(); // something was added or taken off meanwhile
    }
    const res = await t.streamSession.updateMany({
      where: { id, version: expectedVersion },
      data: { entryOrder: keys, version: { increment: 1 } },
    });
    if (res.count !== 1) throw LiveProblems.changed();
    await audit(
      {
        action: 'session.reorder',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'StreamSession',
        targetId: id,
        metadata: { entries: keys.length },
      },
      t,
    );
    return t.streamSession.findUniqueOrThrow({ where: { id } });
  });
  await refreshOverlays(['fila']);
  return s;
}

/**
 * "Limpar encerradas e canceladas" (2026-11-09): hides every DONE or CANCELLED session from the
 * agenda and the Cronograma. Nothing is deleted: what was watched on them (and the episodes of a
 * series watched so far) stays.
 */
export async function clearPastSessions(ctx: Ctx, now = new Date()) {
  return inTx(async (t) => {
    const res = await t.streamSession.updateMany({
      where: { status: { in: ['DONE', 'CANCELLED'] }, hiddenAt: null },
      data: { hiddenAt: now, version: { increment: 1 } },
    });
    await audit(
      {
        action: 'session.clear',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'StreamSession',
        targetId: null,
        metadata: { hidden: res.count },
      },
      t,
    );
    return { hidden: res.count };
  });
}

// ── the queue ────────────────────────────────────────────────────────────────

export type QueueEntry = {
  kind: 'ORDER' | 'CAMPAIGN' | 'SEGMENT';
  id: string;
  version: number;
  status: string;
  /** the catalog title; null only for a custom event */
  item: {
    id: string;
    kind: 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME';
    slug: string;
    title: string;
  } | null;
  runtimeMinutes: number;
  sponsor: string | null;
  message: string | null;
  tier: 'topo' | 'prioridade' | null;
  since: string;
  sessionId: string | null;
  publicCode: string | null;
  /** SEGMENT only (2026-11-04): a part of a series/franchise, or a custom event */
  segment: {
    kind: 'PART' | 'EVENT';
    label: string;
    note: string | null;
    campaignId: string | null;
    atStart: boolean;
    /** EVENT only (2026-11-09) */
    poster: Picture | null;
    posterId: string | null;
  } | null;
  /** CAMPAIGN in the queue: its parts booked or watched so far, oldest first */
  parts?: {
    label: string;
    status: 'SCHEDULED' | 'PLAYING' | 'DONE';
    startsAt: string;
    season: number | null;
    episodeTo: number | null;
    film: number | null;
  }[];
  /** CAMPAIGN in the queue: what the dashboard needs to book a part */
  plan?: {
    seasonCount: number | null;
    episodeCount: number | null;
    runtimeMinutes: number;
    films: { position: number; title: string; runtimeMinutes: number }[];
  };
};

/** Watched / shown: a completed movie, a watched campaign, a segment that was on. */
export function entryDone(e: Pick<QueueEntry, 'status'>): boolean {
  return e.status === 'COMPLETED' || e.status === 'WATCHED' || e.status === 'DONE';
}

const TIER_RANK = { topo: 0, prioridade: 1 } as const;

function tierOf(id: string | null): QueueEntry['tier'] {
  return id === 'topo' || id === 'prioridade' ? id : null;
}

const orderEntrySelect = {
  id: true,
  version: true,
  status: true,
  runtimeMinutes: true,
  queueJumpTierId: true,
  paidAt: true,
  sessionId: true,
  publicCode: true,
  item: { select: { id: true, kind: true, slug: true, title: true } },
  ...sponsorSelect,
} satisfies Prisma.OrderSelect;

const campaignEntrySelect = {
  id: true,
  version: true,
  status: true,
  fundedAt: true,
  sessionId: true,
  item: { select: { id: true, kind: true, slug: true, title: true, runtimeMinutes: true } },
} satisfies Prisma.CampaignSelect;

const segmentEntrySelect = {
  id: true,
  version: true,
  status: true,
  kind: true,
  label: true,
  note: true,
  minutes: true,
  atStart: true,
  createdAt: true,
  sessionId: true,
  campaignId: true,
  campaign: { select: { item: { select: { id: true, kind: true, slug: true, title: true } } } },
  posterId: true,
  poster: { select: { width: true, height: true, variants: true } },
} satisfies Prisma.LiveSegmentSelect;

function segmentEntry(
  g: Prisma.LiveSegmentGetPayload<{ select: typeof segmentEntrySelect }>,
): QueueEntry {
  return {
    kind: 'SEGMENT',
    id: g.id,
    version: g.version,
    status: g.status,
    item: g.campaign?.item ?? null,
    runtimeMinutes: g.minutes,
    sponsor: null,
    message: null,
    tier: null,
    since: g.createdAt.toISOString(),
    sessionId: g.sessionId,
    publicCode: null,
    segment: {
      kind: g.kind,
      label: g.label,
      note: g.note,
      campaignId: g.campaignId,
      atStart: g.atStart,
      poster: pictureFrom(g.poster),
      posterId: g.posterId,
    },
  };
}

function orderEntry(o: Prisma.OrderGetPayload<{ select: typeof orderEntrySelect }>): QueueEntry {
  return {
    kind: 'ORDER',
    id: o.id,
    version: o.version,
    status: o.status,
    item: o.item,
    runtimeMinutes: o.runtimeMinutes ?? 0,
    sponsor: publicSponsor(o),
    message: publicMessage(o),
    tier: tierOf(o.queueJumpTierId),
    since: (o.paidAt ?? new Date(0)).toISOString(),
    sessionId: o.sessionId,
    publicCode: o.publicCode,
    segment: null,
  };
}

function campaignEntry(
  c: Prisma.CampaignGetPayload<{ select: typeof campaignEntrySelect }>,
): QueueEntry {
  return {
    kind: 'CAMPAIGN',
    id: c.id,
    version: c.version,
    status: c.status,
    item: { id: c.item.id, kind: c.item.kind, slug: c.item.slug, title: c.item.title },
    runtimeMinutes: c.item.runtimeMinutes,
    sponsor: null,
    message: null,
    tier: null,
    since: (c.fundedAt ?? new Date(0)).toISOString(),
    sessionId: c.sessionId,
    publicCode: null,
    segment: null,
  };
}

/**
 * Queue order (04 §5): "Topo da fila" first, then "Prioridade", then by when it was paid (a
 * segment: when it was added). A segment marked "no começo da live" comes before all of them.
 */
export function byQueueOrder(a: QueueEntry, b: QueueEntry): number {
  const rank = (e: QueueEntry) => (e.segment?.atStart ? -1 : e.tier ? TIER_RANK[e.tier] : 2);
  return rank(a) - rank(b) || a.since.localeCompare(b.since) || a.id.localeCompare(b.id);
}

/** Paid movies and funded campaigns not on a session yet. */
export async function queue(): Promise<QueueEntry[]> {
  const [orders, campaigns] = await Promise.all([
    db().order.findMany({
      where: { kind: 'MOVIE', status: 'PAID' },
      select: orderEntrySelect,
      take: 200,
    }),
    db().campaign.findMany({ where: { status: 'FUNDED' }, select: campaignEntrySelect, take: 50 }),
  ]);
  // a funded series/franchise is watched in parts over several lives and stays here meanwhile
  const parts = campaigns.length
    ? await db().liveSegment.findMany({
        where: {
          campaignId: { in: campaigns.map((c) => c.id) },
          status: { in: ['SCHEDULED', 'PLAYING', 'DONE'] },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          campaignId: true,
          label: true,
          status: true,
          seasonNumber: true,
          episodeTo: true,
          franchisePosition: true,
          session: { select: { startsAt: true } },
        },
      })
    : [];
  const plans = new Map(
    (campaigns.length
      ? await db().catalogItem.findMany({
          where: { id: { in: campaigns.map((c) => c.item.id) } },
          select: {
            id: true,
            seasonCount: true,
            episodeCount: true,
            runtimeMinutes: true,
            franchiseEntries: {
              orderBy: { position: 'asc' },
              select: { position: true, title: true, runtimeMinutes: true },
            },
          },
        })
      : []
    ).map((i) => [
      i.id,
      {
        seasonCount: i.seasonCount,
        episodeCount: i.episodeCount,
        runtimeMinutes: i.runtimeMinutes,
        films: i.franchiseEntries,
      },
    ]),
  );
  const partsOf = (id: string) =>
    parts
      .filter((p) => p.campaignId === id)
      .map((p) => ({
        label: p.label,
        status: p.status as 'SCHEDULED' | 'PLAYING' | 'DONE',
        startsAt: p.session.startsAt.toISOString(),
        season: p.seasonNumber,
        episodeTo: p.episodeTo,
        film: p.franchisePosition,
      }));
  return [
    ...orders.map(orderEntry),
    ...campaigns.map((c) => ({
      ...campaignEntry(c),
      parts: partsOf(c.id),
      ...(plans.has(c.item.id) ? { plan: plans.get(c.item.id)! } : {}),
    })),
  ].sort(byQueueOrder);
}

/** Sessions from `from` on, with what's scheduled on each (admin agenda and public schedule). */
export async function sessionsWithEntries(opts: {
  from: Date;
  to?: Date;
  statuses?: ('PLANNED' | 'LIVE' | 'DONE' | 'CANCELLED')[];
  take?: number;
}) {
  const sessions = await db().streamSession.findMany({
    where: {
      OR: [
        { startsAt: { gte: opts.from, ...(opts.to ? { lte: opts.to } : {}) } },
        { status: 'LIVE' },
      ],
      ...(opts.statuses ? { status: { in: opts.statuses } } : {}),
      hiddenAt: null, // "Limpar encerradas e canceladas" (2026-11-09)
    },
    orderBy: { startsAt: 'asc' },
    take: opts.take ?? 30,
    include: sessionInclude,
  });
  return sessions.map(withEntries);
}

const sessionInclude = {
  orders: {
    where: { status: { in: ['SCHEDULED', 'WATCHING', 'COMPLETED'] } },
    select: orderEntrySelect,
  },
  campaigns: { select: campaignEntrySelect },
  segments: { where: { status: { not: 'SKIPPED' } }, select: segmentEntrySelect },
  nowItem: { select: { id: true, title: true } },
} satisfies Prisma.StreamSessionInclude;

export const entryKey = (e: Pick<QueueEntry, 'kind' | 'id'>) => `${e.kind}:${e.id}`;

/**
 * A session's entries (2026-11-09): the ones the dashboard ordered by hand first, in that order;
 * the rest (added later, or never ordered) after them in queue order.
 */
export function sortEntries(entries: QueueEntry[], order: readonly string[]): QueueEntry[] {
  const at = new Map(order.map((k, i) => [k, i]));
  return [...entries].sort((a, b) => {
    const ia = at.get(entryKey(a));
    const ib = at.get(entryKey(b));
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return byQueueOrder(a, b);
  });
}

function withEntries({
  orders,
  campaigns,
  segments,
  ...s
}: Prisma.StreamSessionGetPayload<{ include: typeof sessionInclude }>) {
  const entries = sortEntries(
    [...orders.map(orderEntry), ...campaigns.map(campaignEntry), ...segments.map(segmentEntry)],
    s.entryOrder,
  );
  return {
    ...s,
    entries,
    /** what is on screen: a playing segment wins over the session's title (2026-11-04) */
    playing: entries.find((e) => e.status === 'PLAYING') ?? null,
  };
}

/** One session with what's scheduled on it (title pages: position and estimated time). */
export async function sessionWithEntries(id: string) {
  const s = await db().streamSession.findUnique({ where: { id }, include: sessionInclude });
  return s ? withEntries(s) : null;
}

// ── putting things on (and off) a session ─────────────────────────────────────

type Target = { kind: 'ORDER' | 'CAMPAIGN'; id: string; expectedVersion: number };

export async function schedule(ctx: Ctx, target: Target, sessionId: string, now = new Date()) {
  const result = await inTx(async (t) => {
    const s = await t.streamSession.findUnique({ where: { id: sessionId } });
    if (!s) throw Problems.notFound();
    if (s.status !== 'PLANNED' && s.status !== 'LIVE') {
      throw LiveProblems.state('Só dá para agendar em sessões planejadas ou ao vivo.');
    }
    if (target.kind === 'ORDER') {
      const o = await t.order.findUnique({ where: { id: target.id } });
      if (!o || o.kind !== 'MOVIE') throw Problems.notFound();
      if (o.status !== 'PAID' || o.version !== target.expectedVersion) throw LiveProblems.changed();
      const room = await t.streamSession.updateMany({
        where: {
          id: sessionId,
          status: { in: ['PLANNED', 'LIVE'] },
          bookedMinutes: { lte: s.capacityMinutes - (o.runtimeMinutes ?? 0) },
          capacityMinutes: s.capacityMinutes,
        },
        data: { bookedMinutes: { increment: o.runtimeMinutes ?? 0 } },
      });
      if (room.count !== 1) throw LiveProblems.full();
      const res = await t.order.updateMany({
        where: { id: o.id, status: 'PAID', version: o.version },
        data: { status: 'SCHEDULED', sessionId, scheduledAt: now, version: { increment: 1 } },
      });
      if (res.count !== 1) throw LiveProblems.changed();
      await audit(
        {
          action: 'schedule.add',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'Order',
          targetId: o.id,
          metadata: { sessionId, kind: 'ORDER', runtimeMinutes: o.runtimeMinutes ?? 0 },
        },
        t,
      );
      return { orderId: o.id };
    }
    const c = await t.campaign.findUnique({ where: { id: target.id } });
    if (!c) throw Problems.notFound();
    const res = await t.campaign.updateMany({
      where: { id: c.id, status: 'FUNDED', version: target.expectedVersion },
      data: { status: 'SCHEDULED', sessionId, scheduledAt: now, version: { increment: 1 } },
    });
    if (res.count !== 1) throw LiveProblems.changed();
    await audit(
      {
        action: 'schedule.add',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Campaign',
        targetId: c.id,
        metadata: { sessionId, kind: 'CAMPAIGN', runtimeMinutes: 0 },
      },
      t,
    );
    return { orderId: null };
  });
  if (result.orderId) await tellOrders([result.orderId], now);
  await refreshOverlays(['fila']);
}

export async function unschedule(ctx: Ctx, target: Target, now = new Date()) {
  const result = await inTx(async (t) => {
    if (target.kind === 'ORDER') {
      const o = await t.order.findUnique({ where: { id: target.id } });
      if (!o || o.kind !== 'MOVIE') throw Problems.notFound();
      if (o.status !== 'SCHEDULED' || o.version !== target.expectedVersion || !o.sessionId) {
        throw LiveProblems.changed();
      }
      const res = await t.order.updateMany({
        where: { id: o.id, status: 'SCHEDULED', version: o.version },
        data: { status: 'PAID', sessionId: null, scheduledAt: null, version: { increment: 1 } },
      });
      if (res.count !== 1) throw LiveProblems.changed();
      await t.streamSession.updateMany({
        where: { id: o.sessionId, bookedMinutes: { gte: o.runtimeMinutes ?? 0 } },
        data: { bookedMinutes: { decrement: o.runtimeMinutes ?? 0 } },
      });
      await audit(
        {
          action: 'schedule.remove',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'Order',
          targetId: o.id,
          metadata: { sessionId: o.sessionId, kind: 'ORDER' },
        },
        t,
      );
      return { orderId: o.id };
    }
    const c = await t.campaign.findUnique({ where: { id: target.id } });
    if (!c || !c.sessionId) throw c ? LiveProblems.changed() : Problems.notFound();
    const res = await t.campaign.updateMany({
      where: { id: c.id, status: 'SCHEDULED', version: target.expectedVersion },
      data: { status: 'FUNDED', sessionId: null, scheduledAt: null, version: { increment: 1 } },
    });
    if (res.count !== 1) throw LiveProblems.changed();
    await audit(
      {
        action: 'schedule.remove',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Campaign',
        targetId: c.id,
        metadata: { sessionId: c.sessionId, kind: 'CAMPAIGN' },
      },
      t,
    );
    return { orderId: null };
  });
  if (result.orderId) await tellOrders([result.orderId], now);
  await refreshOverlays(['fila']);
}

/** "Agora assistindo": the live session shows this title; a movie order becomes WATCHING. */
export async function nowPlaying(ctx: Ctx, target: Target, now = new Date()) {
  const changed: string[] = [];
  await inTx(async (t) => {
    const live = await t.streamSession.findFirst({ where: { status: 'LIVE' } });
    if (!live) throw LiveProblems.state('Comece a sessão ao vivo antes.');
    let itemId: string;
    if (target.kind === 'ORDER') {
      const o = await t.order.findUnique({ where: { id: target.id } });
      if (!o || o.kind !== 'MOVIE') throw Problems.notFound();
      if (o.sessionId !== live.id)
        throw LiveProblems.state('Este filme não está na sessão ao vivo.');
      if (o.version !== target.expectedVersion || o.status !== 'SCHEDULED')
        throw LiveProblems.changed();
      // whatever was playing goes back to "scheduled" in the same session
      changed.push(...(await stopPlaying(t, live.id)));
      const res = await t.order.updateMany({
        where: { id: o.id, status: 'SCHEDULED', version: o.version },
        data: { status: 'WATCHING', version: { increment: 1 } },
      });
      if (res.count !== 1) throw LiveProblems.changed();
      changed.push(o.id);
      itemId = o.itemId;
    } else {
      const c = await t.campaign.findUnique({ where: { id: target.id } });
      if (!c) throw Problems.notFound();
      if (c.sessionId !== live.id || c.status !== 'SCHEDULED') {
        throw LiveProblems.state('Esta campanha não está na sessão ao vivo.');
      }
      changed.push(...(await stopPlaying(t, live.id)));
      itemId = c.itemId;
    }
    const res = await t.streamSession.updateMany({
      where: { id: live.id, status: 'LIVE' },
      data: { nowItemId: itemId, version: { increment: 1 } },
    });
    if (res.count !== 1) throw LiveProblems.changed();
    await audit(
      {
        action: 'schedule.now',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: target.kind === 'ORDER' ? 'Order' : 'Campaign',
        targetId: target.id,
        metadata: { sessionId: live.id },
      },
      t,
    );
  });
  await tellOrders(changed, now);
  await refreshOverlays(['agora', 'fila']);
}

/**
 * Inside a transaction: the title was watched — the movie order is COMPLETED (or the campaign
 * WATCHED), the item becomes WATCHED and a WatchEvent opens its reviews. Shared with the
 * dashboard's "Marcar como assistido".
 */
export async function completeInTx(
  t: Tx,
  itemId: string,
  sessionId: string | null,
  now: Date,
): Promise<{ orderIds: string[] }> {
  const item = await t.catalogItem.findUniqueOrThrow({
    where: { id: itemId },
    include: { campaign: true },
  });
  const orderIds: string[] = [];
  let orderId: string | null = null;
  if (item.kind === 'MOVIE') {
    const o = await t.order.findFirst({
      where: { itemId, kind: 'MOVIE', status: { in: ['PAID', 'SCHEDULED', 'WATCHING'] } },
    });
    if (o) {
      const res = await t.order.updateMany({
        where: { id: o.id, version: o.version, status: o.status },
        data: { status: 'COMPLETED', completedAt: now, version: { increment: 1 } },
      });
      if (res.count !== 1) throw LiveProblems.changed();
      orderId = o.id;
      orderIds.push(o.id);
    }
  } else if (item.campaign) {
    await t.campaign.update({
      where: { id: item.campaign.id },
      data: { status: 'WATCHED', version: { increment: 1 } },
    });
    // its parts (2026-11-04): the one on screen was watched; parts still booked are dropped
    await t.liveSegment.updateMany({
      where: { campaignId: item.campaign.id, status: 'PLAYING' },
      data: { status: 'DONE', doneAt: now, version: { increment: 1 } },
    });
    const later = await t.liveSegment.findMany({
      where: { campaignId: item.campaign.id, status: 'SCHEDULED' },
      select: { sessionId: true },
    });
    if (later.length) {
      await t.liveSegment.updateMany({
        where: { campaignId: item.campaign.id, status: 'SCHEDULED' },
        data: { status: 'SKIPPED', version: { increment: 1 } },
      });
      for (const sid of new Set(later.map((l) => l.sessionId))) {
        await t.streamSession.update({
          where: { id: sid },
          data: { bookedMinutes: await bookedOn(t, sid) },
        });
      }
    }
  }
  const res = await t.catalogItem.updateMany({
    where: { id: itemId, status: item.status, version: item.version },
    data: { status: 'WATCHED', watchedAt: now },
  });
  if (res.count !== 1) throw LiveProblems.changed();
  await t.watchEvent.create({
    data: { itemId, watchedAt: now, sessionId, ...(orderId ? { orderId } : {}) },
  });
  await t.streamSession.updateMany({
    where: { nowItemId: itemId },
    data: { nowItemId: null, version: { increment: 1 } },
  });
  return { orderIds };
}

/**
 * "Desmarcar assistido" (2026-11-09): undoes a "Concluído" / "Marcar como assistido" that was a
 * mistake. The title goes back to what it was before (a movie with a sponsor → SPONSORED and its
 * order back in the queue as PAID; a watched campaign → FUNDED, back in the queue; a movie
 * without an order → ACTIVE). The latest WatchEvent is removed (reviews already written stay);
 * parts of a series stay as they were (DONE/SKIPPED, it's their history).
 */
export async function uncompleteInTx(
  t: Tx,
  itemId: string,
  expectedVersion: number,
): Promise<{ orderIds: string[]; status: 'ACTIVE' | 'SPONSORED' | 'FUNDED' | 'DRAFT' }> {
  const item = await t.catalogItem.findUnique({
    where: { id: itemId },
    include: { campaign: true },
  });
  if (!item) throw Problems.notFound();
  if (item.status !== 'WATCHED' || item.version !== expectedVersion) {
    throw item.status === 'WATCHED'
      ? LiveProblems.changed()
      : LiveProblems.state('Este título não está marcado como assistido.');
  }
  const orderIds: string[] = [];
  let status: 'ACTIVE' | 'SPONSORED' | 'FUNDED' = 'ACTIVE';
  if (item.kind === 'MOVIE') {
    const o = await t.order.findFirst({
      where: { itemId, kind: 'MOVIE', status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
    });
    if (o) {
      const res = await t.order.updateMany({
        where: { id: o.id, version: o.version, status: 'COMPLETED' },
        data: {
          status: 'PAID',
          completedAt: null,
          sessionId: null,
          scheduledAt: null,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw LiveProblems.changed();
      orderIds.push(o.id);
      status = 'SPONSORED';
    }
  } else if (item.campaign) {
    if (item.campaign.status !== 'WATCHED') throw LiveProblems.changed();
    await t.campaign.update({
      where: { id: item.campaign.id },
      data: { status: 'FUNDED', sessionId: null, scheduledAt: null, version: { increment: 1 } },
    });
    status = 'FUNDED';
  }
  const res = await t.catalogItem.updateMany({
    where: { id: itemId, status: 'WATCHED', version: expectedVersion },
    data: { status, watchedAt: null },
  });
  if (res.count !== 1) throw LiveProblems.changed();
  // back to ACTIVE takes a free slot; with the board full the title comes back as a draft
  // (the catalog guard trigger, 2026-11-09)
  const now = await t.catalogItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { status: true },
  });
  const last = await t.watchEvent.findFirst({
    where: { itemId },
    orderBy: { watchedAt: 'desc' },
    select: { id: true },
  });
  if (last) await t.watchEvent.delete({ where: { id: last.id } });
  return { orderIds, status: now.status === 'DRAFT' ? 'DRAFT' : status };
}

/** "Concluído": watched on the live session. */
export async function complete(ctx: Ctx, target: Target, now = new Date()) {
  const result = await inTx(async (t) => {
    let itemId: string;
    let sessionId: string;
    if (target.kind === 'ORDER') {
      const o = await t.order.findUnique({ where: { id: target.id } });
      if (!o || o.kind !== 'MOVIE') throw Problems.notFound();
      if (o.version !== target.expectedVersion || !['SCHEDULED', 'WATCHING'].includes(o.status)) {
        throw LiveProblems.changed();
      }
      itemId = o.itemId;
      sessionId = o.sessionId!;
    } else {
      const c = await t.campaign.findUnique({ where: { id: target.id } });
      if (!c) throw Problems.notFound();
      if (c.version !== target.expectedVersion || c.status !== 'SCHEDULED')
        throw LiveProblems.changed();
      itemId = c.itemId;
      sessionId = c.sessionId!;
    }
    const s = await t.streamSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (s.status !== 'LIVE')
      throw LiveProblems.state('Só dá para concluir durante a sessão ao vivo.');
    const done = await completeInTx(t, itemId, sessionId, now);
    await audit(
      {
        action: 'schedule.complete',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: target.kind === 'ORDER' ? 'Order' : 'Campaign',
        targetId: target.id,
        metadata: { sessionId },
      },
      t,
    );
    return done;
  });
  await tellOrders(result.orderIds, now);
  await refreshOverlays(['agora', 'fila', 'meta']);
}

// ── the buyer moves their own date (04 §7) ────────────────────────────────────

export async function rescheduleOwn(
  user: { id: string; role: Role },
  orderId: string,
  sessionId: string,
  requestId: string | null,
  now = new Date(),
) {
  await inTx(async (t) => {
    const o = await t.order.findUnique({ where: { id: orderId }, include: { session: true } });
    if (!o || o.userId !== user.id || o.kind !== 'MOVIE') throw Problems.notFound();
    if (o.status !== 'SCHEDULED' || !o.session) {
      throw LiveProblems.rescheduleClosed('Só dá para trocar a data de um filme já agendado.');
    }
    if ((o.rescheduleCount ?? 0) >= RESCHEDULE_MAX) {
      throw LiveProblems.rescheduleClosed('Você já trocou a data 2 vezes.');
    }
    if (o.session.startsAt.getTime() - now.getTime() < RESCHEDULE_MIN_NOTICE_MS) {
      throw LiveProblems.rescheduleClosed(
        'Faltam menos de 24 horas para a sessão: a data não muda mais.',
      );
    }
    if (o.sessionId === sessionId)
      throw LiveProblems.rescheduleClosed('Esta já é a sessão do seu filme.');
    const target = await t.streamSession.findUnique({ where: { id: sessionId } });
    if (
      !target ||
      target.status !== 'PLANNED' ||
      target.startsAt.getTime() < now.getTime() + RESCHEDULE_MIN_NOTICE_MS ||
      target.startsAt.getTime() > now.getTime() + RESCHEDULE_HORIZON_MS
    ) {
      throw LiveProblems.rescheduleClosed('Escolha uma sessão planejada nos próximos 60 dias.');
    }
    const runtime = o.runtimeMinutes ?? 0;
    const room = await t.streamSession.updateMany({
      where: {
        id: sessionId,
        status: 'PLANNED',
        bookedMinutes: { lte: target.capacityMinutes - runtime },
        capacityMinutes: target.capacityMinutes,
      },
      data: { bookedMinutes: { increment: runtime } },
    });
    if (room.count !== 1) throw LiveProblems.full();
    await t.streamSession.updateMany({
      where: { id: o.sessionId!, bookedMinutes: { gte: runtime } },
      data: { bookedMinutes: { decrement: runtime } },
    });
    const res = await t.order.updateMany({
      where: { id: o.id, status: 'SCHEDULED', version: o.version },
      data: {
        sessionId,
        scheduledAt: now,
        rescheduleCount: { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) throw LiveProblems.changed();
    await audit(
      {
        action: 'order.reschedule',
        actor: user,
        requestId,
        targetType: 'Order',
        targetId: o.id,
        metadata: { from: o.sessionId!, to: sessionId, count: (o.rescheduleCount ?? 0) + 1 },
      },
      t,
    );
  });
  await refreshOverlays(['fila']);
}

/** Sessions an owner may move to (PLANNED, 24 h – 60 days ahead, with room for the runtime). */
export async function rescheduleOptions(
  runtimeMinutes: number,
  currentSessionId: string | null,
  now = new Date(),
) {
  const rows = await db().streamSession.findMany({
    where: {
      status: 'PLANNED',
      startsAt: {
        gte: new Date(now.getTime() + RESCHEDULE_MIN_NOTICE_MS),
        lte: new Date(now.getTime() + RESCHEDULE_HORIZON_MS),
      },
      ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
    },
    orderBy: { startsAt: 'asc' },
    take: 20,
  });
  return rows
    .filter((s) => s.capacityMinutes - s.bookedMinutes >= runtimeMinutes)
    .map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), publicNote: s.publicNote }));
}
