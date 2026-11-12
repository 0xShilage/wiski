/**
 * Emblemas art (2026-11-12): PNG, GIF and WebM-as-frames through the media pipeline. Animated
 * badges stay animated (WebP) with a still first frame; nothing else may be animated or a GIF.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type MediaVariant, pictureFrom, stillFrom } from '@/lib/media';
import { resetEnvCache } from '@/server/env';
import { ingestFile } from '@/server/media/pipeline';
import { clearCatalog } from '../support/catalog';
import { makeUser } from '../support/db';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wf-badge-test-'));
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

const frame = (i: number, size = 200) =>
  sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: (i * 60) % 255, g: 40 + i * 10, b: 200 - i * 15, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

async function gif(n: number, size = 200) {
  const frames = await Promise.all(Array.from({ length: n }, (_, i) => frame(i, size)));
  return sharp(frames, { join: { animated: true } })
    .gif({ delay: Array(n).fill(100), loop: 0 })
    .toBuffer();
}

/** what the dashboard builds from a WebM: a grid of square frames, `cols` per row */
async function spriteOf(n: number, cols: number, tile = 192) {
  const rows = Math.ceil(n / cols);
  const parts = await Promise.all(
    Array.from({ length: n }, async (_, i) => ({
      input: await frame(i, tile),
      left: (i % cols) * tile,
      top: Math.floor(i / cols) * tile,
    })),
  );
  return sharp({
    create: { width: cols * tile, height: rows * tile, channels: 4, background: '#00000000' },
  })
    .composite(parts)
    .webp({ quality: 90 })
    .toBuffer();
}

const file = (name: string, data: Buffer) => {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
};
const variants = (a: { variants: unknown }) => a.variants as MediaVariant[];

describe('badge art', () => {
  it('a static PNG with transparency becomes a square AVIF + WebP badge', async () => {
    const u = await makeUser({ role: 'MODERATOR' });
    const png = await sharp({
      create: {
        width: 300,
        height: 260,
        channels: 4,
        background: { r: 200, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const { asset } = await ingestFile(file('a.png', png), 'BADGE', u.id);
    expect(asset.role).toBe('BADGE');
    expect([asset.width, asset.height]).toEqual([256, 256]);
    expect(variants(asset).some((v) => v.animated)).toBe(false);
    expect(stillFrom(asset)).toBeNull();
    expect(pictureFrom(asset)?.avif).toMatch(/-128\.avif 128w/);
  });

  it('an animated GIF stays animated (WebP) and gets a still first frame', async () => {
    const u = await makeUser({ role: 'MODERATOR' });
    const { asset } = await ingestFile(file('a.gif', await gif(6)), 'BADGE', u.id);
    const anim = variants(asset).filter((v) => v.animated);
    expect(anim.map((v) => v.w)).toEqual([128, 200]); // no upscaling: the source is 200 px
    const out = await sharp(join(dir, anim[0]!.path.replace('/media/', '')), {
      animated: true,
    }).metadata();
    expect(out.format).toBe('webp');
    expect(out.pages).toBe(6);
    expect(out.pageHeight).toBe(128);
    const still = stillFrom(asset)!;
    expect(still.avif).toMatch(/\.avif/);
    expect(pictureFrom(asset)!.avif).toBe(''); // the animation has no AVIF
    const first = await sharp(join(dir, still.fallback.replace('/media/', ''))).metadata();
    expect(first.pages ?? 1).toBe(1);
  });

  it('a WebM, sent as a grid of frames, comes back as an animation at its speed', async () => {
    const u = await makeUser({ role: 'MODERATOR' });
    const sprite = await spriteOf(10, 4);
    const { asset } = await ingestFile(file('s.webp', sprite), 'BADGE', u.id, 0, {
      frames: 10,
      fps: 10,
      cols: 4,
    });
    const anim = variants(asset).find((v) => v.animated)!;
    const out = await sharp(join(dir, anim.path.replace('/media/', '')), {
      animated: true,
    }).metadata();
    expect(out.pages).toBe(10);
    expect(out.delay?.every((d) => d === 100)).toBe(true);
    expect(out.loop).toBe(0);
  });

  it('refuses a sprite that does not add up, too many frames, and animation or GIF elsewhere', async () => {
    const u = await makeUser({ role: 'MODERATOR' });
    const sprite = file('bad.webp', await spriteOf(10, 4));
    await expect(
      ingestFile(sprite, 'BADGE', u.id, 0, { frames: 10, fps: 10, cols: 3 }),
    ).rejects.toMatchObject({ status: 422, code: 'SPRITE_INVALID' });
    await expect(
      ingestFile(sprite, 'BADGE', u.id, 0, { frames: 200, fps: 10, cols: 4 }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(ingestFile(file('g.gif', await gif(3)), 'POSTER', u.id)).rejects.toMatchObject({
      status: 415,
    });
    await expect(
      ingestFile(file('p.png', await frame(1, 900)), 'POSTER', u.id, 0, {
        frames: 2,
        fps: 10,
        cols: 1,
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      ingestFile(file('long.gif', await gif(160, 130)), 'BADGE', u.id),
    ).rejects.toMatchObject({
      code: 'IMAGE_TOO_MANY_FRAMES',
    });
    await expect(
      ingestFile(file('tiny.gif', await gif(3, 64)), 'BADGE', u.id),
    ).rejects.toMatchObject({
      code: 'IMAGE_TOO_SMALL',
    });
    expect(readFileSync(sprite).length).toBeGreaterThan(0);
  });
});
