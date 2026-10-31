import 'server-only';
import type { Prisma, Role } from '@/generated/prisma/client';
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

async function inTx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
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

function cleanNote(raw: string | null | undefined): string | null | undefined {
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

/** Take scheduled titles of a session back to the queue (PAID / FUNDED). */
async function returnToQueue(t: Tx, sessionId: string): Promise<string[]> {
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
  const booked = await t.order.aggregate({
    where: { sessionId, kind: 'MOVIE', status: { in: ['SCHEDULED', 'WATCHING', 'COMPLETED'] } },
    _sum: { runtimeMinutes: true },
  });
  await t.streamSession.update({
    where: { id: sessionId },
    data: { bookedMinutes: booked._sum.runtimeMinutes ?? 0 },
  });
  return orders.map((o) => o.id);
}

async function tellOrders(ids: string[], now: Date) {
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
    returned = await returnToQueue(t, id);
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
    returned = await returnToQueue(t, id);
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

// ── the queue ────────────────────────────────────────────────────────────────

export type QueueEntry = {
  kind: 'ORDER' | 'CAMPAIGN';
  id: string;
  version: number;
  status: string;
  item: { id: string; kind: 'MOVIE' | 'SERIES' | 'FRANCHISE'; slug: string; title: string };
  runtimeMinutes: number;
  sponsor: string | null;
  message: string | null;
  tier: 'topo' | 'prioridade' | null;
  since: string;
  sessionId: string | null;
  publicCode: string | null;
};

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
  };
}

/** Queue order (04 §5): "Topo da fila" first, then "Prioridade", then by when it was paid. */
export function byQueueOrder(a: QueueEntry, b: QueueEntry): number {
  const ra = a.tier ? TIER_RANK[a.tier] : 2;
  const rb = b.tier ? TIER_RANK[b.tier] : 2;
  return ra - rb || a.since.localeCompare(b.since) || a.id.localeCompare(b.id);
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
  return [...orders.map(orderEntry), ...campaigns.map(campaignEntry)].sort(byQueueOrder);
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
    },
    orderBy: { startsAt: 'asc' },
    take: opts.take ?? 30,
    include: {
      orders: {
        where: { status: { in: ['SCHEDULED', 'WATCHING', 'COMPLETED'] } },
        select: orderEntrySelect,
      },
      campaigns: { select: campaignEntrySelect },
      nowItem: { select: { id: true, title: true } },
    },
  });
  return sessions.map(({ orders, campaigns, ...s }) => ({
    ...s,
    entries: [...orders.map(orderEntry), ...campaigns.map(campaignEntry)].sort(byQueueOrder),
  }));
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
      const prev = await t.order.findMany({
        where: { sessionId: live.id, status: 'WATCHING' },
        select: { id: true },
      });
      await t.order.updateMany({
        where: { sessionId: live.id, status: 'WATCHING' },
        data: { status: 'SCHEDULED', version: { increment: 1 } },
      });
      changed.push(...prev.map((p) => p.id));
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
      const prev = await t.order.findMany({
        where: { sessionId: live.id, status: 'WATCHING' },
        select: { id: true },
      });
      await t.order.updateMany({
        where: { sessionId: live.id, status: 'WATCHING' },
        data: { status: 'SCHEDULED', version: { increment: 1 } },
      });
      changed.push(...prev.map((p) => p.id));
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
