import 'server-only';
import { db } from '../db';
import { overlayGoal } from '../goals/goals';
import { totalGoal } from '../goals/total';
import { logger } from '../log';
import { subathonSnapshot } from '../subathon/overlay';
import { publicMessage, publicSponsor, sponsorSelect } from '../live/sponsor';
import { streamSafe, streamSafeName } from '@/lib/stream-safe';
import { randomToken } from '../security/crypto';
import {
  chatLine,
  getAlertSettings,
  sayInChat,
  spokenLine,
  storeVoice,
  synthesize,
} from './alerts';
import { publishOverlay } from './publish';
import {
  goalEvent,
  nowPlayingEvent,
  queueEvent,
  sponsorshipEvent,
  sponsorshipId,
  totalGoalEvent,
  type OverlayEvent,
  type Widget,
} from './events';

/**
 * What each overlay widget shows right now, and the fan-out when it changes. Snapshots are rebuilt
 * from the database (never from an event body) and published on `wf:overlay:<widget>`.
 */
export { overlayChannel } from './publish';

/** "T1 · E1–E3" of a series reads "Série X · T1 · E1–E3"; an event is its own title. */
const segmentTitleSelect = {
  label: true,
  campaign: { select: { item: { select: { title: true, kind: true } } } },
} as const;
function segmentTitle(g: { label: string; campaign: { item: { title: string } } | null }) {
  return g.campaign ? `${g.campaign.item.title} · ${g.label}` : g.label;
}

export async function nowPlayingSnapshot(): Promise<OverlayEvent> {
  // a part of a series/franchise or a custom event on screen (2026-11-04)
  const segment = await db().liveSegment.findFirst({
    where: { status: 'PLAYING', session: { status: 'LIVE' } },
    select: segmentTitleSelect,
  });
  if (segment) {
    return nowPlayingEvent({
      title: segmentTitle(segment),
      kind: segment.campaign?.item.kind ?? null,
      sponsor: null,
      message: null,
    });
  }
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

type QueueItem = {
  title: string;
  sponsor: string | null;
  jumped: boolean;
  rank: number;
  at: number;
};

const queueRank = (tier: string | null) => (tier === 'topo' ? 0 : tier === 'prioridade' ? 1 : 2);
const queueOrderSel = {
  queueJumpTierId: true,
  paidAt: true,
  item: { select: { title: true } },
  ...sponsorSelect,
} as const;

/** The titles scheduled on one session, in schedule order (what is at the start first). */
async function scheduledOn(sessionId: string): Promise<QueueItem[]> {
  const [orders, campaigns, segments] = await Promise.all([
    db().order.findMany({
      where: { sessionId, status: 'SCHEDULED' },
      select: queueOrderSel,
      take: 10,
    }),
    db().campaign.findMany({
      where: { sessionId, status: 'SCHEDULED' },
      select: { fundedAt: true, item: { select: { title: true } } },
      take: 5,
    }),
    db().liveSegment.findMany({
      where: { sessionId, status: 'SCHEDULED' },
      select: { ...segmentTitleSelect, atStart: true, createdAt: true },
      take: 10,
    }),
  ]);
  const items: QueueItem[] = [
    ...orders.map((o) => ({
      title: o.item.title,
      sponsor: publicSponsor(o),
      jumped: !!o.queueJumpTierId,
      rank: queueRank(o.queueJumpTierId),
      at: o.paidAt?.getTime() ?? 0,
    })),
    ...campaigns.map((c) => ({
      title: c.item.title,
      sponsor: null,
      jumped: false,
      rank: 2,
      at: c.fundedAt?.getTime() ?? 0,
    })),
    ...segments.map((g) => ({
      title: segmentTitle(g),
      sponsor: null,
      jumped: false,
      rank: g.atStart ? -1 : 2,
      at: g.createdAt.getTime(),
    })),
  ];
  return items.sort((a, b) => a.rank - b.rank || a.at - b.at);
}

/**
 * "Próximos da fila" (2026-11-10): the next 5 titles on the agenda da live (cronograma) — the live
 * session's scheduled titles first, then the next planned sessions', in schedule order. It follows
 * the schedule, not the unscheduled queue (the Fila tab).
 */
export async function queueSnapshot(now = new Date()): Promise<OverlayEvent> {
  const sessions = await db().streamSession.findMany({
    where: {
      hiddenAt: null,
      OR: [
        { status: 'LIVE' },
        { status: 'PLANNED', startsAt: { gte: new Date(now.getTime() - 6 * 3_600_000) } },
      ],
    },
    orderBy: { startsAt: 'asc' },
    select: { id: true, status: true, startsAt: true },
    take: 6,
  });
  // the live session first, then the planned ones by date
  sessions.sort(
    (a, b) =>
      (a.status === 'LIVE' ? 0 : 1) - (b.status === 'LIVE' ? 0 : 1) ||
      a.startsAt.getTime() - b.startsAt.getTime(),
  );
  const items: QueueItem[] = [];
  for (const session of sessions) {
    if (items.length >= 5) break;
    items.push(...(await scheduledOn(session.id)));
  }
  return queueEvent(items.slice(0, 5));
}

export async function goalSnapshot(): Promise<OverlayEvent> {
  return goalEvent(await overlayGoal());
}

export async function totalGoalSnapshot(): Promise<OverlayEvent> {
  return totalGoalEvent(await totalGoal());
}

export async function snapshot(w: Widget): Promise<OverlayEvent | null> {
  if (w === 'agora') return nowPlayingSnapshot();
  if (w === 'fila') return queueSnapshot();
  if (w === 'meta') return goalSnapshot();
  if (w === 'meta-total') return totalGoalSnapshot();
  if (w === 'subathon') return subathonSnapshot();
  return null; // "Novo patrocínio" only shows live events
}

const publish = publishOverlay;

/**
 * After a commit that changes what a widget shows. Best effort: overlays also resync on reconnect.
 * Anything that moves a goal ("meta") can move "Meta total" too, so it is refreshed with it.
 */
export async function refreshOverlays(widgets: Widget[]): Promise<void> {
  const all = new Set(widgets);
  if (all.has('meta')) all.add('meta-total');
  for (const w of all) {
    try {
      const e = await snapshot(w);
      if (e) await publish(w, e);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : 'unknown', widget: w },
        'overlay refresh failed',
      );
    }
  }
}

/**
 * "Testar alerta" (2026-11-09): a sample "Novo patrocínio" with the current voice, to set up OBS
 * audio. Never posted in chat.
 */
export async function testSponsorshipAlert(now = new Date()): Promise<{ voice: boolean }> {
  const settings = await getAlertSettings();
  const nonce = randomToken(6);
  const sample = {
    sponsor: 'Wiskiflix',
    title: 'Filme de teste',
    message: 'Este é um teste do alerta de patrocínio.',
  };
  let voice = false;
  if (settings.voice && settings.voiceReady) {
    const mp3 = await synthesize(spokenLine(sample), settings.voiceName);
    voice = !!mp3 && (await storeVoice(sponsorshipId(now, nonce), mp3));
  }
  const e = sponsorshipEvent(sample.title, sample.sponsor, now, nonce, {
    message: sample.message,
    voice,
  });
  if (e) await publish('patrocinio', e);
  return { voice };
}

/**
 * A movie or a contribution was just paid (on the site, or registered as "Já pago"): "Novo
 * patrocínio" + the queue and the goal moved. 2026-11-09: the alert carries the sponsor's name
 * (logged in: @username; guest: the name typed; none or "Anônimo" ticked: null) and message, both
 * through `streamSafe`; a voice reads it (if set up) and the StreamElements bot thanks the sponsor
 * in chat (once per order).
 */
export async function announcePaidOrder(orderId: string, now = new Date()): Promise<void> {
  try {
    const o = await db().order.findUnique({
      where: { id: orderId },
      select: { kind: true, status: true, item: { select: { title: true } }, ...sponsorSelect },
    });
    if (!o || o.status !== 'PAID') return;
    const sponsor = streamSafeName(publicSponsor(o));
    const message = streamSafe(publicMessage(o));
    const nonce = randomToken(6);
    const settings = await getAlertSettings();
    let voice = false;
    if (settings.voice && settings.voiceReady) {
      const mp3 = await synthesize(
        spokenLine({ sponsor, title: o.item.title, message: message?.spoken ?? null }),
        settings.voiceName,
      );
      voice = !!mp3 && (await storeVoice(sponsorshipId(now, nonce), mp3));
    }
    const e = sponsorshipEvent(o.item.title, sponsor, now, nonce, {
      message: message?.shown ?? null,
      voice,
    });
    if (e) await publish('patrocinio', e);
    if (settings.chat && settings.chatReady) {
      await sayInChat(`order:${orderId}`, chatLine({ sponsor, title: o.item.title }));
    }
    await refreshOverlays(o.kind === 'MOVIE' ? ['fila', 'meta'] : ['meta']);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'overlay announce failed');
  }
}
