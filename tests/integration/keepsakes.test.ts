/**
 * Keepsakes (2026-11-13): the poster palette (upload, filled in once, CHECK), the marathon trail
 * (built from the Agenda's parts) and the most-liked review for the clipping.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { episodesLabel } from '@/lib/live/segments';
import { marathonTrail } from '@/lib/trail';
import { getPublic } from '@/server/catalog/read';
import { db } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { ingestFile } from '@/server/media/pipeline';
import { topReview } from '@/server/reviews/read';
import { clearCatalog, makeAsset, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { fundedCampaign, makeSession } from '../support/live';

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
  it('follows the parts marked done on the Agenda (a series)', async () => {
    const { item, campaign } = await fundedCampaign();
    await db().catalogItem.update({
      where: { id: item.id },
      data: { seasonCount: 1, episodeCount: 8 },
    });
    const [s1, s2, s3] = await Promise.all([
      makeSession({ inHours: -72, capacity: 300 }),
      makeSession({ inHours: -24, capacity: 300 }),
      makeSession({ inHours: 24, capacity: 300 }),
    ]);
    const part = (sessionId: string, from: number, to: number) => ({
      sessionId,
      kind: 'PART' as const,
      campaignId: campaign.id,
      label: episodesLabel(1, from, to),
      seasonNumber: 1,
      episodeFrom: from,
      episodeTo: to,
      minutes: 135,
    });
    const page = async () => marathonTrail((await getPublic('SERIES', item.slug))!);
    // booked but not shown yet: no trail
    await db().liveSegment.create({ data: part(s3.id, 7, 8) });
    expect(await page()).toBeNull();
    await db().liveSegment.create({
      data: { ...part(s1.id, 1, 3), status: 'DONE', doneAt: new Date(Date.now() + 1_000) },
    });
    await db().liveSegment.create({
      data: { ...part(s2.id, 4, 6), status: 'DONE', doneAt: new Date(Date.now() + 2_000) },
    });
    // a skipped part (the live ended first) is left out
    await db().liveSegment.create({ data: { ...part(s2.id, 7, 7), status: 'SKIPPED' } });
    const trail = (await page())!;
    expect(trail.stops.map((s) => [s.label, s.state, s.here])).toEqual([
      ['T1 · E1–E3', 'done', false],
      ['T1 · E4–E6', 'done', true],
      ['T1 · E7–E8', 'next', false],
      ['Fim', 'todo', false],
    ]);
    expect(trail.summary).toBe('6 de 8 episódios em 2 lives.');
  });

  it('a franchise fills its films; a movie never has a trail', async () => {
    const movie = await makeItem({ status: 'ACTIVE', slot: 1 });
    expect(marathonTrail((await getPublic('MOVIE', movie.slug))!)).toBeNull();
    const { item, campaign } = await fundedCampaign('FRANCHISE');
    const films = await db().franchiseEntry.findMany({
      where: { franchiseId: item.id },
      orderBy: { position: 'asc' },
    });
    expect(films.length).toBeGreaterThanOrEqual(2);
    const s = await makeSession({ inHours: -24, capacity: 300 });
    await db().liveSegment.create({
      data: {
        sessionId: s.id,
        kind: 'PART',
        campaignId: campaign.id,
        label: `Filme ${films[0]!.position}`,
        franchisePosition: films[0]!.position,
        minutes: 120,
        status: 'DONE',
        doneAt: new Date(Date.now() + 1_000), // CHECK: done after it was booked
      },
    });
    const trail = marathonTrail((await getPublic('FRANCHISE', item.slug))!)!;
    expect(trail.stops.map((x) => x.state)).toEqual([
      'done',
      'next',
      ...films.slice(2).map(() => 'todo'),
    ]);
    expect(trail.stops[0]!.here).toBe(true);
    expect(trail.summary).toBe(`1 de ${films.length} filmes assistidos.`);
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
