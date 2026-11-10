import 'server-only';
import { isEpisodic } from '@/lib/catalog/kinds';
import type { LiveSegment, Prisma } from '@/generated/prisma/client';
import { episodesLabel, filmLabel } from '@/lib/live/segments';
import { audit } from '../audit/audit';
import { Problems } from '../http/problem';
import { refreshOverlays } from '../overlay/state';
import {
  cleanNote,
  completeInTx,
  type Ctx,
  inTx,
  LiveProblems,
  stopPlaying,
  tellOrders,
} from './schedule';

/**
 * Live segments (2026-11-04). A funded series or franchise is no longer one block on one live:
 * the streamer books a few episodes ("T1 · E1–E3") or one film of the franchise per live, and the
 * campaign stays in the queue until she marks the last part ("fim da série") — only then is the
 * title watched and are its reviews open. A custom event ("Jogando com os Viewers") is a segment
 * with a title and a length, nothing else.
 *
 * Segment minutes count against the session's capacity exactly like a movie's runtime (the same
 * conditional update). Orders are never touched here except through schedule.ts helpers
 * (`stopPlaying`, `completeInTx`), which keep the order state machine in one place.
 */
type Tx = Prisma.TransactionClient;
type Target = { id: string; expectedVersion: number };

const LIVE_OR_PLANNED = ['PLANNED', 'LIVE'] as const;

async function bookableSession(t: Tx, sessionId: string) {
  const s = await t.streamSession.findUnique({ where: { id: sessionId } });
  if (!s) throw Problems.notFound();
  if (s.status !== 'PLANNED' && s.status !== 'LIVE') {
    throw LiveProblems.state('Só dá para agendar em sessões planejadas ou ao vivo.');
  }
  return s;
}

/** Book `minutes` on the session, or fail if it doesn't fit (same guard as a movie). */
async function reserve(
  t: Tx,
  s: { id: string; capacityMinutes: number },
  minutes: number,
): Promise<void> {
  const room = await t.streamSession.updateMany({
    where: {
      id: s.id,
      status: { in: [...LIVE_OR_PLANNED] },
      bookedMinutes: { lte: s.capacityMinutes - minutes },
      capacityMinutes: s.capacityMinutes,
    },
    data: { bookedMinutes: { increment: minutes } },
  });
  if (room.count !== 1) throw LiveProblems.full();
}

/** An uploaded poster (2026-11-09): must exist and have been uploaded as a POSTER. */
async function posterOf(t: Tx, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const a = await t.mediaAsset.findUnique({ where: { id }, select: { role: true } });
  if (!a || a.role !== 'POSTER') {
    throw Problems.validation([{ path: 'posterId', message: 'Envie a imagem como pôster.' }]);
  }
  return id;
}

async function logAdd(t: Tx, ctx: Ctx, g: LiveSegment) {
  await audit(
    {
      action: 'segment.add',
      actor: ctx.actor,
      requestId: ctx.requestId,
      targetType: 'LiveSegment',
      targetId: g.id,
      metadata: { sessionId: g.sessionId, kind: g.kind, minutes: g.minutes },
    },
    t,
  );
}

export type PartInput = {
  campaignId: string;
  sessionId: string;
  season?: number | undefined;
  episodeFrom?: number | undefined;
  episodeTo?: number | undefined;
  film?: number | undefined;
  minutes: number;
  note?: string | null | undefined;
  atStart?: boolean | undefined;
};

/** A few episodes of a funded series, or one film of a funded franchise, on a session. */
export async function addPart(ctx: Ctx, input: PartInput) {
  const note = cleanNote(input.note) ?? null;
  const g = await inTx(async (t) => {
    const s = await bookableSession(t, input.sessionId);
    const c = await t.campaign.findUnique({
      where: { id: input.campaignId },
      include: { item: { include: { franchiseEntries: true } } },
    });
    if (!c) throw Problems.notFound();
    if (c.status === 'SCHEDULED') {
      throw LiveProblems.state(
        'Esta campanha está agendada inteira numa sessão. Tire-a de lá para agendar por partes.',
      );
    }
    if (c.status !== 'FUNDED') {
      throw LiveProblems.state('Só séries e franquias com a meta atingida entram na live.');
    }
    const item = c.item;
    let fields: Pick<
      Prisma.LiveSegmentUncheckedCreateInput,
      'label' | 'seasonNumber' | 'episodeFrom' | 'episodeTo' | 'franchisePosition'
    >;
    if (isEpisodic(item.kind)) {
      if (input.film !== undefined) {
        throw Problems.validation([
          { path: 'film', message: 'Séries são agendadas por episódio.' },
        ]);
      }
      const season = input.season;
      const from = input.episodeFrom;
      const to = input.episodeTo ?? from;
      if (!season || !from || !to) {
        throw Problems.validation([
          { path: 'episodeFrom', message: 'Informe a temporada e os episódios.' },
        ]);
      }
      if (item.seasonCount && season > item.seasonCount) {
        throw Problems.validation([
          { path: 'season', message: `Esta série tem ${item.seasonCount} temporada(s).` },
        ]);
      }
      if (to < from) {
        throw Problems.validation([
          { path: 'episodeTo', message: 'O último episódio vem depois do primeiro.' },
        ]);
      }
      fields = {
        label: episodesLabel(season, from, to),
        seasonNumber: season,
        episodeFrom: from,
        episodeTo: to,
        franchisePosition: null,
      };
    } else {
      if (input.season !== undefined || input.episodeFrom !== undefined) {
        throw Problems.validation([
          { path: 'film', message: 'Franquias são agendadas por filme.' },
        ]);
      }
      const film = item.franchiseEntries.find((e) => e.position === input.film);
      if (!film) {
        throw Problems.validation([{ path: 'film', message: 'Escolha um filme da franquia.' }]);
      }
      fields = {
        label: filmLabel(film.position, film.title),
        seasonNumber: null,
        episodeFrom: null,
        episodeTo: null,
        franchisePosition: film.position,
      };
    }
    await reserve(t, s, input.minutes);
    const created = await t.liveSegment.create({
      data: {
        sessionId: s.id,
        kind: 'PART',
        campaignId: c.id,
        ...fields,
        note,
        minutes: input.minutes,
        atStart: input.atStart ?? false,
      },
    });
    await logAdd(t, ctx, created);
    return created;
  });
  await refreshOverlays(['fila']);
  return g;
}

export type EventInput = {
  sessionId: string;
  title: string;
  minutes: number;
  note?: string | null | undefined;
  atStart?: boolean | undefined;
  posterId?: string | null | undefined;
};

/** A custom event on a session ("Jogando com os Viewers"). */
export async function addEvent(ctx: Ctx, input: EventInput) {
  const note = cleanNote(input.note) ?? null;
  const g = await inTx(async (t) => {
    const s = await bookableSession(t, input.sessionId);
    const posterId = await posterOf(t, input.posterId);
    await reserve(t, s, input.minutes);
    const created = await t.liveSegment.create({
      data: {
        sessionId: s.id,
        kind: 'EVENT',
        label: input.title,
        note,
        minutes: input.minutes,
        atStart: input.atStart ?? false,
        posterId,
      },
    });
    await logAdd(t, ctx, created);
    return created;
  });
  await refreshOverlays(['fila']);
  return g;
}

/** "Trocar pôster" / "Tirar pôster" on a custom event (2026-11-09), in any state. */
export async function setEventPoster(ctx: Ctx, target: Target, posterId: string | null) {
  await inTx(async (t) => {
    const g = await t.liveSegment.findUnique({ where: { id: target.id } });
    if (!g) throw Problems.notFound();
    if (g.kind !== 'EVENT') throw LiveProblems.state('Só eventos têm pôster próprio.');
    const poster = await posterOf(t, posterId);
    const res = await t.liveSegment.updateMany({
      where: { id: g.id, version: target.expectedVersion },
      data: { posterId: poster, version: { increment: 1 } },
    });
    if (res.count !== 1) throw LiveProblems.changed();
    await audit(
      {
        action: 'segment.poster',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'LiveSegment',
        targetId: g.id,
        metadata: { sessionId: g.sessionId, poster: poster !== null },
      },
      t,
    );
  });
  await refreshOverlays(['agora', 'fila']);
}

/** Take a booked segment off its session (before it's on screen). */
export async function removeSegment(ctx: Ctx, target: Target) {
  await inTx(async (t) => {
    const g = await t.liveSegment.findUnique({ where: { id: target.id } });
    if (!g) throw Problems.notFound();
    if (g.status !== 'SCHEDULED' || g.version !== target.expectedVersion) {
      throw LiveProblems.changed();
    }
    const res = await t.liveSegment.deleteMany({
      where: { id: g.id, status: 'SCHEDULED', version: g.version },
    });
    if (res.count !== 1) throw LiveProblems.changed();
    await t.streamSession.updateMany({
      where: { id: g.sessionId, bookedMinutes: { gte: g.minutes } },
      data: { bookedMinutes: { decrement: g.minutes } },
    });
    await audit(
      {
        action: 'segment.remove',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'LiveSegment',
        targetId: g.id,
        metadata: { sessionId: g.sessionId, kind: g.kind },
      },
      t,
    );
  });
  await refreshOverlays(['fila']);
}

/** "Agora assistindo" / "Agora": this segment is on screen; whatever was playing goes back. */
export async function segmentNow(ctx: Ctx, target: Target, now = new Date()) {
  const changed: string[] = [];
  await inTx(async (t) => {
    const live = await t.streamSession.findFirst({ where: { status: 'LIVE' } });
    if (!live) throw LiveProblems.state('Comece a sessão ao vivo antes.');
    const g = await t.liveSegment.findUnique({
      where: { id: target.id },
      include: { campaign: { select: { itemId: true } } },
    });
    if (!g) throw Problems.notFound();
    if (g.sessionId !== live.id) throw LiveProblems.state('Isto não está na sessão ao vivo.');
    if (g.status !== 'SCHEDULED' || g.version !== target.expectedVersion) {
      throw LiveProblems.changed();
    }
    changed.push(...(await stopPlaying(t, live.id)));
    const res = await t.liveSegment.updateMany({
      where: { id: g.id, status: 'SCHEDULED', version: g.version },
      data: { status: 'PLAYING', version: { increment: 1 } },
    });
    if (res.count !== 1) throw LiveProblems.changed();
    // a part shows its series on the session ("Agora assistindo"); an event has no title page
    const s = await t.streamSession.updateMany({
      where: { id: live.id, status: 'LIVE' },
      data: { nowItemId: g.campaign?.itemId ?? null, version: { increment: 1 } },
    });
    if (s.count !== 1) throw LiveProblems.changed();
    await audit(
      {
        action: 'segment.now',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'LiveSegment',
        targetId: g.id,
        metadata: { sessionId: live.id },
      },
      t,
    );
  });
  await tellOrders(changed, now);
  await refreshOverlays(['agora', 'fila']);
}

/**
 * "Concluído": the segment was on. With `finish` (a part only) it was the last one: the campaign
 * is WATCHED, the title too, and its reviews open — the same path as a movie's "Concluído".
 */
export async function completeSegment(ctx: Ctx, target: Target, finish: boolean, now = new Date()) {
  await inTx(async (t) => {
    const g = await t.liveSegment.findUnique({
      where: { id: target.id },
      include: { campaign: { select: { itemId: true } }, session: true },
    });
    if (!g) throw Problems.notFound();
    if (
      g.version !== target.expectedVersion ||
      (g.status !== 'SCHEDULED' && g.status !== 'PLAYING')
    ) {
      throw LiveProblems.changed();
    }
    if (g.session.status !== 'LIVE') {
      throw LiveProblems.state('Só dá para concluir durante a sessão ao vivo.');
    }
    if (finish && g.kind !== 'PART') {
      throw Problems.validation([{ path: 'finish', message: 'Só partes de séries e franquias.' }]);
    }
    const res = await t.liveSegment.updateMany({
      where: { id: g.id, version: g.version, status: g.status },
      data: { status: 'DONE', doneAt: now, version: { increment: 1 } },
    });
    if (res.count !== 1) throw LiveProblems.changed();
    if (g.status === 'PLAYING') {
      await t.streamSession.updateMany({
        where: { id: g.sessionId, status: 'LIVE' },
        data: { nowItemId: null, version: { increment: 1 } },
      });
    }
    if (finish && g.campaign) await completeInTx(t, g.campaign.itemId, g.sessionId, now);
    await audit(
      {
        action: 'segment.complete',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'LiveSegment',
        targetId: g.id,
        metadata: { sessionId: g.sessionId, finish },
      },
      t,
    );
  });
  await refreshOverlays(finish ? ['agora', 'fila', 'meta'] : ['agora', 'fila']);
}
