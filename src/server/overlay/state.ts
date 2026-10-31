import 'server-only';
import { db } from '../db';
import { overlayGoal } from '../goals/goals';
import { logger } from '../log';
import { redis } from '../redis';
import { publicMessage, publicSponsor, sponsorSelect } from '../live/sponsor';
import {
  goalEvent,
  nowPlayingEvent,
  queueEvent,
  sponsorshipEvent,
  type OverlayEvent,
  type Widget,
} from './events';

/**
 * What each overlay widget shows right now, and the fan-out when it changes. Snapshots are rebuilt
 * from the database (never from an event body) and published on `wf:overlay:<widget>`.
 */
export const overlayChannel = (w: Widget) => `wf:overlay:${w}`;

export async function nowPlayingSnapshot(): Promise<OverlayEvent> {
  const live = await db().streamSession.findFirst({
    where: { status: 'LIVE', nowItemId: { not: null } },
    select: { nowItem: { select: { id: true, title: true, kind: true } } },
  });
  const item = live?.nowItem;
  if (!item) return nowPlayingEvent(null);
  const order =
    item.kind === 'MOVIE'
      ? await db().order.findFirst({
          where: { itemId: item.id, kind: 'MOVIE', status: { in: ['WATCHING', 'SCHEDULED'] } },
          select: sponsorSelect,
        })
      : null;
  return nowPlayingEvent({
    title: item.title,
    kind: item.kind,
    sponsor: order ? publicSponsor(order) : null,
    message: order ? publicMessage(order) : null,
  });
}

/** Next 5: what's scheduled on the live (or next planned) session, then the unscheduled queue. */
export async function queueSnapshot(now = new Date()): Promise<OverlayEvent> {
  const session =
    (await db().streamSession.findFirst({ where: { status: 'LIVE' } })) ??
    (await db().streamSession.findFirst({
      where: { status: 'PLANNED', startsAt: { gte: new Date(now.getTime() - 6 * 3_600_000) } },
      orderBy: { startsAt: 'asc' },
    }));
  const items: { title: string; sponsor: string | null; jumped: boolean; rank: number; at: number }[] =
    [];
  const rank = (tier: string | null) => (tier === 'topo' ? 0 : tier === 'prioridade' ? 1 : 2);
  const orderSel = {
    queueJumpTierId: true,
    paidAt: true,
    item: { select: { title: true } },
    ...sponsorSelect,
  } as const;
  if (session) {
    const [orders, campaigns] = await Promise.all([
      db().order.findMany({
        where: { sessionId: session.id, status: 'SCHEDULED' },
        select: orderSel,
        take: 10,
      }),
      db().campaign.findMany({
        where: { sessionId: session.id, status: 'SCHEDULED' },
        select: { fundedAt: true, item: { select: { title: true } } },
        take: 5,
      }),
    ]);
    for (const o of orders) {
      items.push({
        title: o.item.title,
        sponsor: publicSponsor(o),
        jumped: !!o.queueJumpTierId,
        rank: rank(o.queueJumpTierId),
        at: o.paidAt?.getTime() ?? 0,
      });
    }
    for (const c of campaigns) {
      items.push({ title: c.item.title, sponsor: null, jumped: false, rank: 2, at: c.fundedAt?.getTime() ?? 0 });
    }
  }
  items.sort((a, b) => a.rank - b.rank || a.at - b.at);
  if (items.length < 5) {
    const queued = await db().order.findMany({
      where: { kind: 'MOVIE', status: 'PAID' },
      select: orderSel,
      take: 20,
    });
    const rest = queued
      .map((o) => ({
        title: o.item.title,
        sponsor: publicSponsor(o),
        jumped: !!o.queueJumpTierId,
        rank: rank(o.queueJumpTierId),
        at: o.paidAt?.getTime() ?? 0,
      }))
      .sort((a, b) => a.rank - b.rank || a.at - b.at);
    items.push(...rest);
  }
  return queueEvent(items.slice(0, 5));
}

export async function goalSnapshot(): Promise<OverlayEvent> {
  return goalEvent(await overlayGoal());
}

export async function snapshot(w: Widget): Promise<OverlayEvent | null> {
  if (w === 'agora') return nowPlayingSnapshot();
  if (w === 'fila') return queueSnapshot();
  if (w === 'meta') return goalSnapshot();
  return null; // "Novo patrocínio" only shows live events
}

async function publish(w: Widget, e: OverlayEvent) {
  try {
    await redis().publish(overlayChannel(w), JSON.stringify(e));
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'overlay publish failed');
  }
}

/** After a commit that changes what a widget shows. Best effort: overlays also resync on reconnect. */
export async function refreshOverlays(widgets: Widget[]): Promise<void> {
  for (const w of new Set(widgets)) {
    try {
      const e = await snapshot(w);
      if (e) await publish(w, e);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : 'unknown', widget: w }, 'overlay refresh failed');
    }
  }
}

/** A movie was just paid: "Novo patrocínio" + the queue and the goal moved. */
export async function announcePaidOrder(orderId: string): Promise<void> {
  try {
    const o = await db().order.findUnique({
      where: { id: orderId },
      select: { kind: true, status: true, item: { select: { title: true } }, ...sponsorSelect },
    });
    if (!o || o.status !== 'PAID') return;
    const e = sponsorshipEvent(o.item.title, publicSponsor(o));
    if (e) await publish('patrocinio', e);
    await refreshOverlays(o.kind === 'MOVIE' ? ['fila', 'meta'] : ['meta']);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'overlay announce failed');
  }
}
