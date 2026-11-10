import 'server-only';
import type { Game, GameStatus, Role } from '@/generated/prisma/client';
import { type Picture, pictureFrom } from '@/lib/media';
import { audit } from '../audit/audit';
import { db } from '../db';
import { HttpError, Problems } from '../http/problem';

/**
 * Jogos (2026-11-09): the games Iara played on stream, a showcase on /jogos (no sponsorship).
 * Moderators add them by hand in the dashboard: title, cover (2:3, media pipeline), platform,
 * year, status (Jogando / Zerado / Dropado), the day it was finished or dropped, a short note and
 * a link to the VOD (Twitch or YouTube only).
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

export const GAME_STATUS_PT: Record<GameStatus, string> = {
  PLAYING: 'Jogando',
  FINISHED: 'Zerado',
  DROPPED: 'Dropado',
};

export type GameView = {
  id: string;
  title: string;
  platform: string | null;
  year: number | null;
  status: GameStatus;
  note: string | null;
  vodUrl: string | null;
  finishedOn: string | null;
  coverId: string | null;
  cover: Picture | null;
  version: number;
};

export type GameInput = {
  title: string;
  platform?: string | null | undefined;
  year?: number | null | undefined;
  status: GameStatus;
  note?: string | null | undefined;
  vodUrl?: string | null | undefined;
  finishedOn?: string | null | undefined;
  coverId?: string | null | undefined;
};

const coverSelect = { cover: { select: { width: true, height: true, variants: true } } } as const;

function view(
  g: Game & { cover: { width: number; height: number; variants: unknown } | null },
): GameView {
  return {
    id: g.id,
    title: g.title,
    platform: g.platform,
    year: g.year,
    status: g.status,
    note: g.note,
    vodUrl: g.vodUrl,
    finishedOn: g.finishedOn ? g.finishedOn.toISOString().slice(0, 10) : null,
    coverId: g.coverId,
    cover: pictureFrom(g.cover),
    version: g.version,
  };
}

const RANK: Record<GameStatus, number> = { PLAYING: 0, FINISHED: 1, DROPPED: 2 };

/** "Jogando" first, then the finished ones (newest first), then the dropped ones. */
export async function listGames(): Promise<GameView[]> {
  const rows = await db().game.findMany({
    include: coverSelect,
    orderBy: [{ finishedOn: { sort: 'desc', nulls: 'first' } }, { updatedAt: 'desc' }],
    take: 500,
  });
  return rows.map(view).sort((a, b) => RANK[a.status] - RANK[b.status]);
}

const VOD_HOSTS = new Set([
  'twitch.tv',
  'www.twitch.tv',
  'm.twitch.tv',
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
]);

/** An https Twitch/YouTube link, normalised (no credentials, no fragment), or a 422. */
export function cleanVodUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw bad('vodUrl', 'Use um link https da Twitch ou do YouTube.');
  }
  if (u.protocol !== 'https:' || u.username || u.password || !VOD_HOSTS.has(u.hostname)) {
    throw bad('vodUrl', 'Use um link https da Twitch ou do YouTube.');
  }
  u.hash = '';
  const out = u.toString();
  if (out.length > 300 || !/^https:\/\/[\w./?=&%-]+$/.test(out)) {
    throw bad('vodUrl', 'Este link tem caracteres que não dá para usar.');
  }
  return out;
}

const bad = (path: string, message: string) => Problems.validation([{ path, message }]);

async function coverOf(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const a = await db().mediaAsset.findUnique({ where: { id }, select: { role: true } });
  if (!a || a.role !== 'POSTER') throw bad('coverId', 'Envie a capa como pôster (2:3).');
  return id;
}

function finished(status: GameStatus, day: string | null | undefined): Date | null {
  if (!day) return null;
  if (status === 'PLAYING') return null; // only a finished or dropped game has a day
  return new Date(`${day}T00:00:00.000Z`);
}

export async function createGame(ctx: Ctx, input: GameInput): Promise<GameView> {
  const data = {
    title: input.title,
    platform: input.platform ?? null,
    year: input.year ?? null,
    status: input.status,
    note: input.note ?? null,
    vodUrl: cleanVodUrl(input.vodUrl),
    finishedOn: finished(input.status, input.finishedOn),
    coverId: await coverOf(input.coverId),
  };
  const row = await db().$transaction(async (t) => {
    const g = await t.game.create({ data: { ...data, createdById: ctx.actor.id } });
    await audit(
      {
        action: 'game.create',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Game',
        targetId: g.id,
        metadata: { status: g.status },
      },
      t,
    );
    return t.game.findUniqueOrThrow({ where: { id: g.id }, include: coverSelect });
  });
  return view(row);
}

export async function updateGame(
  ctx: Ctx,
  id: string,
  expectedVersion: number,
  input: GameInput,
): Promise<GameView> {
  const data = {
    title: input.title,
    platform: input.platform ?? null,
    year: input.year ?? null,
    status: input.status,
    note: input.note ?? null,
    vodUrl: cleanVodUrl(input.vodUrl),
    finishedOn: finished(input.status, input.finishedOn),
    coverId: await coverOf(input.coverId),
  };
  const row = await db().$transaction(async (t) => {
    const res = await t.game.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) {
      if (!(await t.game.count({ where: { id } }))) throw Problems.notFound();
      throw changed();
    }
    await audit(
      {
        action: 'game.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Game',
        targetId: id,
        metadata: { status: data.status },
      },
      t,
    );
    return t.game.findUniqueOrThrow({ where: { id }, include: coverSelect });
  });
  return view(row);
}

export async function deleteGame(ctx: Ctx, id: string): Promise<void> {
  await db().$transaction(async (t) => {
    const res = await t.game.deleteMany({ where: { id } });
    if (res.count !== 1) throw Problems.notFound();
    await audit(
      {
        action: 'game.delete',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Game',
        targetId: id,
        metadata: {},
      },
      t,
    );
  });
}

const changed = () =>
  new HttpError(409, 'GAME_CHANGED', 'Outra pessoa mudou este jogo agora mesmo. Recarregue.');
