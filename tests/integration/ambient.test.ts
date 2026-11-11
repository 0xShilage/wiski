/**
 * Ambient glow (2026-11-11, prisma/migrations/*_media_accent_constraints): a poster's accent is
 * worked out at upload, filled in once for older posters, and only ever a #rrggbb.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPublic } from '@/server/catalog/read';
import { db } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { ingestFile } from '@/server/media/pipeline';
import { clearCatalog, makeAsset, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wf-ambient-test-'));
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

/** A poster-sized image: dark, with a block of one colour (and a little noise, so it's unique). */
async function poster(rgb: [number, number, number], w = 600, h = 900, seed = Date.now()) {
  const raw = Buffer.alloc(w * h * 3);
  let x = seed & 0x7fffffff;
  for (let i = 0; i < w * h; i++) {
    const row = Math.floor(i / w);
    const inBlock = row > h * 0.3 && row < h * 0.6;
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const n = x & 7;
    raw[i * 3] = inBlock ? rgb[0] : 12 + n;
    raw[i * 3 + 1] = inBlock ? rgb[1] : 10 + n;
    raw[i * 3 + 2] = inBlock ? rgb[2] : 18 + n;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return { r: r!, g: g!, b: b! };
};

describe('media accent', () => {
  it('the database only takes a lowercase #rrggbb', async () => {
    const a = await makeAsset('POSTER');
    for (const bad of ['red', '#ABCDEF', '#abc', 'url(x)', '#abcdefg'])
      await expect(
        db().mediaAsset.update({ where: { id: a.id }, data: { accent: bad } }),
      ).rejects.toThrow();
    await db().mediaAsset.update({ where: { id: a.id }, data: { accent: '#abcdef' } });
  });

  it('is worked out at upload for posters (the colour of the poster), not for backdrops', async () => {
    const user = await makeUser({ role: 'MODERATOR' });
    const file = join(dir, 'red.png');
    writeFileSync(file, await poster([200, 30, 40]));
    const { asset } = await ingestFile(file, 'POSTER', user.id);
    expect(asset.accent).toMatch(/^#[0-9a-f]{6}$/);
    const { r, g, b } = hue(asset.accent!);
    expect(r).toBeGreaterThan(g + 60);
    expect(r).toBeGreaterThan(b + 40);

    const wide = join(dir, 'wide.png');
    writeFileSync(
      wide,
      await sharp(await poster([30, 200, 40], 600, 900))
        .resize(1920, 1080, { fit: 'fill' })
        .png()
        .toBuffer(),
    );
    const backdrop = await ingestFile(wide, 'BACKDROP', user.id);
    expect(backdrop.asset.accent).toBeNull();
  });

  it('an older poster gets its accent the first time its page is opened, then keeps it', async () => {
    const asset = await makeAsset('POSTER');
    const variants = asset.variants as { path: string; format: string }[];
    const webp = variants.find((v) => v.format === 'webp')!;
    writeFileSync(
      join(dir, webp.path.replace('/media/', '')),
      await sharp(await poster([40, 90, 220]))
        .webp()
        .toBuffer(),
    );
    const item = await makeItem({ status: 'WATCHED' });
    await db().catalogItem.update({ where: { id: item.id }, data: { posterId: asset.id } });
    expect(asset.accent).toBeNull();

    const page = await getPublic('MOVIE', item.slug);
    expect(page?.accent).toMatch(/^#[0-9a-f]{6}$/);
    const { r, b } = hue(page!.accent!);
    expect(b).toBeGreaterThan(r + 60);
    const stored = await db().mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored.accent).toBe(page!.accent);
    // the next read uses the stored colour
    expect((await getPublic('MOVIE', item.slug))?.accent).toBe(page!.accent);
  });

  it('a poster whose file is gone just has no glow (no error, nothing stored)', async () => {
    const asset = await makeAsset('POSTER');
    const item = await makeItem({ status: 'WATCHED' });
    await db().catalogItem.update({ where: { id: item.id }, data: { posterId: asset.id } });
    const page = await getPublic('MOVIE', item.slug);
    expect(page).not.toBeNull();
    expect(page!.accent).toBeNull();
    expect(
      (await db().mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).accent,
    ).toBeNull();
  });
});
