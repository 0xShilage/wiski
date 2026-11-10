/**
 * Animes and Jogos (2026-11-09). An anime is a series on its own tab: season fields, a goal of
 * R$ 100 per season, a few episodes per live, 20 on the board. A game is a showcase entry on
 * /jogos: added, edited and removed in the dashboard, VOD links only to Twitch or YouTube.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DELETE as gameDelete, PATCH as gamePatch } from '@/app/api/v1/admin/games/[id]/route';
import { GET as gamesGet, POST as gamesPost } from '@/app/api/v1/admin/games/route';
import { POST as scheduleRoute } from '@/app/api/v1/admin/schedule/route';
import { LIVE_LIMIT, seriesGoalCents } from '@/lib/catalog/pricing';
import { db } from '@/server/db';
import { getPublic, listPublic } from '@/server/catalog/read';
import { cleanVodUrl, listGames } from '@/server/games/games';
import { publicQueue } from '@/server/live/public';
import { clearCatalog, makeAsset, makeItem } from '../support/catalog';
import { makeUser, withAdmin } from '../support/db';
import { as, hit, makeSession, resetSlots } from '../support/live';

beforeEach(async () => {
  await clearCatalog();
  await db().game.deleteMany({});
  await db().streamSession.deleteMany({});
  resetSlots();
});

async function fundedAnime(title = 'Frieren') {
  const item = await makeItem({ kind: 'ANIME', status: 'FUNDED', title });
  await db().catalogItem.update({
    where: { id: item.id },
    data: { seasonCount: 2, episodeCount: 28, seasonsLabel: 'Temporadas 1–2' },
  });
  const opener = await makeUser({ role: 'STREAMER' });
  const now = new Date();
  const campaign = await db().campaign.create({
    data: {
      itemId: item.id,
      goalCents: seriesGoalCents(2),
      raisedCents: seriesGoalCents(2),
      remainingCents: 0,
      supporterCount: 4,
      deadlineAt: new Date(now.getTime() + 30 * 86_400_000),
      status: 'FUNDED',
      openedAt: new Date(now.getTime() - 86_400_000),
      openedById: opener.id,
      fundedAt: now,
    },
  });
  return { item, campaign };
}

describe('animes', () => {
  it('a board of 20 on its own tab, with season fields', async () => {
    expect(LIVE_LIMIT.ANIME).toBe(20);
    for (let slot = 1; slot <= 20; slot++) {
      await makeItem({ kind: 'ANIME', status: 'ACTIVE', slot, title: `Anime ${slot}` });
    }
    await withAdmin(async (c) => {
      const d = await makeItem({ kind: 'ANIME', status: 'DRAFT' });
      await expect(
        c.query(`UPDATE "CatalogItem" SET status = 'ACTIVE', "publishedAt" = now() WHERE id = $1`, [
          d.id,
        ]),
      ).rejects.toMatchObject({ code: 'WF409' });
      // season fields are fine on an anime, still refused on a movie
      await expect(
        c.query(`UPDATE "CatalogItem" SET "seasonCount" = 3 WHERE id = $1`, [d.id]),
      ).resolves.toBeTruthy();
      const m = await makeItem({ kind: 'MOVIE' });
      await expect(
        c.query(`UPDATE "CatalogItem" SET "seasonCount" = 3 WHERE id = $1`, [m.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });
    expect(await listPublic('ANIME')).toHaveLength(20);
    expect(await listPublic('SERIES')).toHaveLength(0);
    const first = (await listPublic('ANIME'))[0]!;
    expect((await getPublic('ANIME', first.slug))?.title).toBe('Anime 1');
    expect(await getPublic('SERIES', first.slug)).toBeNull();
  });

  it('with its goal reached: on /fila, and booked a few episodes at a time', async () => {
    const { item, campaign } = await fundedAnime();
    expect((await publicQueue()).map((e) => [e.title, e.kind])).toEqual([[item.title, 'ANIME']]);
    const s = await makeSession({ inHours: 24 });
    const r = await hit(scheduleRoute, 'POST', '/api/v1/admin/schedule', {
      who: await as('MODERATOR'),
      body: {
        action: 'part',
        campaignId: campaign.id,
        sessionId: s.id,
        season: 1,
        episodeFrom: 1,
        episodeTo: 4,
        minutes: 96,
      },
    });
    expect(r.res.status).toBe(200);
    const g = await db().liveSegment.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect([g.label, g.seasonNumber, g.episodeTo]).toEqual(['T1 · E1–E4', 1, 4]);
  });
});

describe('jogos', () => {
  const add = async (body: Record<string, unknown>) =>
    hit(gamesPost, 'POST', '/api/v1/admin/games', { who: await as('MODERATOR'), body });

  it('add, list in order (Jogando, Zerado newest first, Dropado), edit, remove; audited', async () => {
    const cover = await makeAsset('POSTER');
    const a = await add({
      title: 'Hollow Knight',
      platform: 'PC',
      year: 2017,
      status: 'FINISHED',
      finishedOn: '2026-10-01',
      vodUrl: 'https://www.twitch.tv/videos/123456789#t=1h',
      coverId: cover.id,
      note: 'Zerou com 112%!',
    });
    expect(a.res.status).toBe(201);
    expect(a.json.game).toMatchObject({
      title: 'Hollow Knight',
      status: 'FINISHED',
      finishedOn: '2026-10-01',
      vodUrl: 'https://www.twitch.tv/videos/123456789',
    });
    await add({ title: 'Silksong', status: 'PLAYING', finishedOn: '2026-10-05' });
    await add({ title: 'Celeste', status: 'FINISHED', finishedOn: '2026-11-01' });
    await add({ title: 'Dark Souls', status: 'DROPPED' });
    const games = await listGames();
    expect(games.map((g) => g.title)).toEqual([
      'Silksong',
      'Celeste',
      'Hollow Knight',
      'Dark Souls',
    ]);
    // a game still being played has no "Zerado em"
    expect(games[0]!.finishedOn).toBeNull();

    const hk = games.find((g) => g.title === 'Hollow Knight')!;
    const mod = await as('MODERATOR');
    const edit = await hit(gamePatch, 'PATCH', '', {
      who: mod,
      params: { id: hk.id },
      body: { title: 'Hollow Knight', status: 'FINISHED', expectedVersion: hk.version, note: null },
    });
    expect(edit.res.status).toBe(200);
    expect(edit.json.game).toMatchObject({ note: null, coverId: null, version: 1 });
    const stale = await hit(gamePatch, 'PATCH', '', {
      who: mod,
      params: { id: hk.id },
      body: { title: 'X', status: 'PLAYING', expectedVersion: hk.version },
    });
    expect(stale.json.code).toBe('GAME_CHANGED');

    const del = await hit(gameDelete, 'DELETE', '', { who: mod, params: { id: hk.id } });
    expect(del.res.status).toBe(204);
    const list = await hit(gamesGet, 'GET', '/api/v1/admin/games', { who: mod });
    expect((list.json.games as unknown[]).length).toBe(3);
    expect(await db().auditLog.count({ where: { targetType: 'Game' } })).toBeGreaterThanOrEqual(6);
  });

  it('VOD links only to Twitch or YouTube over https; the cover must be a poster', async () => {
    expect(cleanVodUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(cleanVodUrl('')).toBeNull();
    for (const bad of [
      'http://twitch.tv/videos/1',
      'https://evil.example/twitch.tv',
      'https://user:pw@twitch.tv/x',
      ['javascript', 'alert(1)'].join(':'), // a script URL
    ]) {
      expect((await add({ title: 'X', status: 'PLAYING', vodUrl: bad })).res.status).toBe(422);
    }
    const wide = await makeAsset('BACKDROP');
    expect((await add({ title: 'X', status: 'PLAYING', coverId: wide.id })).res.status).toBe(422);
    const g = await db().game.create({
      data: { title: 'Y', createdById: (await makeUser({ role: 'MODERATOR' })).id },
    });
    await withAdmin(async (c) => {
      await expect(
        c.query(`UPDATE "Game" SET "vodUrl" = 'https://evil.example/x' WHERE id = $1`, [g.id]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        c.query(`UPDATE "Game" SET "finishedOn" = '2026-01-01' WHERE id = $1`, [g.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
