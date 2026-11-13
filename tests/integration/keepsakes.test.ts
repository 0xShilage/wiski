/**
 * Keepsakes (2026-11-13): the poster palette (upload, filled in once, CHECK), the marathon trail's
 * progress (dashboard, compare-and-set, audit, CHECK) and the most-liked review for the clipping.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as progressRoute } from '@/app/api/v1/admin/catalog/items/[id]/progress/route';
import { marathonTrail } from '@/lib/trail';
import { getPublic } from '@/server/catalog/read';
import { db } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { ingestFile } from '@/server/media/pipeline';
import { topReview } from '@/server/reviews/read';
import { clearCatalog, makeAsset, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { as, hit } from '../support/live';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wf-keepsakes-test-'));
  process.env.MEDIA_DIR = dir;
  resetEnvCache();
});
afterAll(() => {
  delete process.env.MEDIA_DIR;
  resetEnvCache();
});
beforeEach(async () => {
  await clearCatalog();
});

/** a poster in three bands: mostly red, some blue, a little yellow */
async function bands(seed = Date.now()) {
  const w = 600;
  const h = 900;
  const raw = Buffer.alloc(w * h * 3);
  let x = seed & 0x7fffffff;
  for (let i = 0; i < w * h; i++) {
    const row = Math.floor(i / w);
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const n = x & 3;
    const c = row < h * 0.6 ? [200, 30, 40] : row < h * 0.9 ? [30, 60, 200] : [230, 210, 40];
    raw[i * 3] = c[0]! + n;
    raw[i * 3 + 1] = c[1]! + n;
    raw[i * 3 + 2] = c[2]! + n;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as number[];

describe('poster palette', () => {
  it('is worked out at upload: the poster’s colours, most present first', async () => {
    const user = await makeUser({ role: 'MODERATOR' });
    const file = join(dir, 'bands.png');
    writeFileSync(file, await bands());
    const { asset } = await ingestFile(file, 'POSTER', user.id);
    expect(asset.palette.length).toBeGreaterThanOrEqual(3);
    expect(asset.palette.length).toBeLessThanOrEqual(5);
    const [first, second] = asset.palette.map(rgb);
    expect(first![0]).toBeGreaterThan(first![2]! + 100); // red first
    expect(second![2]).toBeGreaterThan(second![0]! + 100); // then blue
  });

  it('an older poster gets it on its first page view; the database takes only #rrggbb ×5', async () => {
    const asset = await makeAsset('POSTER');
    const webp = (asset.variants as { path: string; format: string }[]).find(
      (v) => v.format === 'webp',
    )!;
    writeFileSync(
      join(dir, webp.path.replace('/media/', '')),
      await sharp(await bands())
        .webp()
        .toBuffer(),
    );
    const item = await makeItem({ status: 'WATCHED' });
    await db().catalogItem.update({ where: { id: item.id }, data: { posterId: asset.id } });
    const page = await getPublic('MOVIE', item.slug);
    expect(page!.palette.length).toBeGreaterThanOrEqual(3);
    expect((await db().mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).palette).toEqual(
      page!.palette,
    );

    for (const bad of [
      ['red', '#abcdef'],
      ['#ABCDEF'],
      ['#abcdef', '#abcdef', '#abcdef', '#abcdef', '#abcdef', '#abcdef'],
    ])
      await expect(
        db().mediaAsset.update({ where: { id: asset.id }, data: { palette: bad } }),
      ).rejects.toThrow();
    const backdrop = await makeAsset('BACKDROP');
    await expect(
      db().mediaAsset.update({ where: { id: backdrop.id }, data: { palette: ['#abcdef'] } }),
    ).rejects.toThrow();
  });
});

describe('marathon trail', () => {
  const step = (who: Awaited<ReturnType<typeof as>>, id: string, from: number, to: number) =>
    hit(progressRoute, 'POST', '', { who, params: { id }, body: { from, to } });

  it('moves one stop at a time from the dashboard, compare-and-set, audited', async () => {
    const mod = await as('MODERATOR');
    const series = await makeItem({ kind: 'SERIES', status: 'FUNDED', slot: 1, seasonCount: 4 });
    const r = await step(mod, series.id, 0, 1);
    expect(r.res.status).toBe(200);
    expect(r.json.item).toMatchObject({ progress: { done: 1, total: 4 } });
    expect((await step(mod, series.id, 1, 2)).res.status).toBe(200);
    // a stale count (another tab) and a skipped stop are refused
    const stale = await step(mod, series.id, 1, 2);
    expect([stale.res.status, stale.json.code]).toEqual([409, 'PROGRESS_CHANGED']);
    expect((await step(mod, series.id, 2, 4)).json.code).toBe('INVALID_STATE');
    expect((await step(mod, series.id, 2, 1)).res.status).toBe(200); // back one
    const row = await db().catalogItem.findUniqueOrThrow({ where: { id: series.id } });
    expect(row.partsWatched).toBe(1);
    expect(row.partsWatchedAt).not.toBeNull();
    const logs = await db().auditLog.findMany({
      where: { action: 'catalog.progress', targetId: series.id },
      orderBy: { id: 'asc' },
    });
    expect(logs.map((l) => l.metadata)).toEqual([
      { kind: 'SERIES', from: 0, to: 1, total: 4 },
      { kind: 'SERIES', from: 1, to: 2, total: 4 },
      { kind: 'SERIES', from: 2, to: 1, total: 4 },
    ]);

    // the page's trail
    const page = (await getPublic('SERIES', series.slug))!;
    const trail = marathonTrail(page)!;
    expect(trail.stops.map((s) => s.state)).toEqual(['done', 'next', 'todo', 'todo']);

    // back to zero clears the date (CHECK keeps the two together)
    expect((await step(mod, series.id, 1, 0)).res.status).toBe(200);
    expect(
      (await db().catalogItem.findUniqueOrThrow({ where: { id: series.id } })).partsWatchedAt,
    ).toBeNull();
  });

  it('never on a movie, a one-season series, past the end, or for a viewer', async () => {
    const mod = await as('MODERATOR');
    const movie = await makeItem({ status: 'ACTIVE', slot: 1 });
    expect((await step(mod, movie.id, 0, 1)).json.code).toBe('INVALID_STATE');
    const one = await makeItem({ kind: 'SERIES', status: 'ACTIVE', slot: 2, seasonCount: 1 });
    expect((await step(mod, one.id, 0, 1)).json.code).toBe('INVALID_STATE');
    const two = await makeItem({ kind: 'SERIES', status: 'ACTIVE', slot: 3, seasonCount: 2 });
    await step(mod, two.id, 0, 1);
    await step(mod, two.id, 1, 2);
    expect((await step(mod, two.id, 2, 3)).json.code).toBe('INVALID_STATE');
    expect((await step(await as('USER'), two.id, 2, 1)).res.status).toBe(404);
    // the database refuses a count on a movie, a count without its date, or the other way round
    for (const data of [{ partsWatched: 1, partsWatchedAt: new Date() }])
      await expect(db().catalogItem.update({ where: { id: movie.id }, data })).rejects.toThrow();
    for (const data of [
      { partsWatched: 1, partsWatchedAt: null },
      { partsWatched: 0, partsWatchedAt: new Date() },
      { partsWatched: 101, partsWatchedAt: new Date() },
    ])
      await expect(db().catalogItem.update({ where: { id: two.id }, data })).rejects.toThrow();
  });
});

describe('the clipping', () => {
  it('is the most-liked public review without spoilers; none without a like', async () => {
    const item = await makeItem({ status: 'WATCHED' });
    const [a, b, c, fan1, fan2] = await Promise.all([
      makeUser(),
      makeUser(),
      makeUser(),
      makeUser(),
      makeUser(),
    ]);
    expect(await topReview(item.id)).toBeNull();
    const ra = await db().review.create({
      data: { userId: a.id, itemId: item.id, rating: 4, body: 'Muito bom.' },
    });
    const rb = await db().review.create({
      data: { userId: b.id, itemId: item.id, rating: 5, body: 'O final!', containsSpoilers: true },
    });
    await db().review.create({ data: { userId: c.id, itemId: item.id, rating: 3, body: 'Ok.' } });
    expect(await topReview(item.id)).toBeNull();
    await db().reviewLike.create({ data: { userId: fan1.id, reviewId: ra.id } });
    for (const f of [fan1, fan2])
      await db().reviewLike.create({ data: { userId: f.id, reviewId: rb.id } });
    const top = await topReview(item.id);
    expect(top).toMatchObject({ body: 'Muito bom.', likeCount: 1, rating: 4 });
    expect(top!.author.username).toBe(a.username);
  });
});
