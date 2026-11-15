/**
 * Blur-up placeholders (2026-11-14): posters, backgrounds and portraits get a tiny WebP data: URI
 * when uploaded; older ones are filled in by the worker (newest first, '' when the file is gone);
 * pictures only ever carry a well-formed one; the database refuses anything else.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LQIP_PATTERN, pictureFrom } from '@/lib/media';
import { db } from '@/server/db';
import { pgErrorCode, PG } from '@/server/db-errors';
import { resetEnvCache } from '@/server/env';
import { backfillLqip } from '@/server/media/lqip';
import { ingestFile } from '@/server/media/pipeline';
import { clearCatalog, makeAsset } from '../support/catalog';
import { makeUser } from '../support/db';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wf-lqip-test-'));
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

async function image(name: string, w: number, h: number, alpha = false) {
  const buf = await sharp({
    create: {
      width: w,
      height: h,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 200, g: 120, b: 40, alpha: 0.5 } : { r: 120, g: 60, b: 160 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="#f2c46d"/></svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
  const file = join(dir, name);
  writeFileSync(file, buf);
  return file;
}

describe('blur-up placeholders', () => {
  it('a poster and a background get one when uploaded; a logo does not', async () => {
    const u = await makeUser({ role: 'MODERATOR' });
    const poster = (await ingestFile(await image('p.png', 600, 900), 'POSTER', u.id)).asset;
    const backdrop = (await ingestFile(await image('b.png', 1920, 1080), 'BACKDROP', u.id)).asset;
    const logo = (await ingestFile(await image('l.png', 600, 120, true), 'LOGO', u.id)).asset;
    for (const a of [poster, backdrop]) {
      expect(a.lqip).toMatch(LQIP_PATTERN);
      expect(a.lqip!.length).toBeLessThan(1500);
      const pic = pictureFrom(a);
      expect(pic?.lqip).toBe(a.lqip);
      // it really is a tiny image of the same shape
      const meta = await sharp(Buffer.from(a.lqip!.split(',')[1]!, 'base64')).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(24);
      expect(Math.abs(meta.height! / meta.width! - a.height / a.width)).toBeLessThan(0.1);
    }
    expect(logo.lqip).toBeNull();
    expect(pictureFrom(logo)?.lqip).toBeUndefined();
  });

  it('the worker fills older assets, newest first, and gives up quietly on a missing file', async () => {
    const u = await makeUser({ role: 'MODERATOR' });
    const real = (await ingestFile(await image('p2.png', 600, 900), 'POSTER', u.id)).asset;
    await db().mediaAsset.update({ where: { id: real.id }, data: { lqip: null } });
    const ghost = await makeAsset('BACKDROP'); // its files were never written
    const logo = await makeAsset('LOGO');
    expect(await backfillLqip(10)).toBe(2);
    const after = await db().mediaAsset.findMany({
      where: { id: { in: [real.id, ghost.id, logo.id] } },
    });
    const by = (id: string) => after.find((a) => a.id === id)!;
    expect(by(real.id).lqip).toMatch(LQIP_PATTERN);
    expect(by(ghost.id).lqip).toBe('');
    expect(by(logo.id).lqip).toBeNull();
    expect(await backfillLqip(10)).toBe(0); // nothing left, nothing retried
    expect(pictureFrom(by(ghost.id))?.lqip).toBeUndefined();
  });

  it('pictures never carry a malformed one, and the database refuses it', async () => {
    const a = await makeAsset('POSTER');
    expect(pictureFrom({ ...a, lqip: 'data:image/png;base64,AAAA' })?.lqip).toBeUndefined();
    expect(
      pictureFrom({ ...a, lqip: 'data:image/webp;base64,AA"); background:url(x' })?.lqip,
    ).toBeUndefined();
    const code = async (lqip: string) => {
      try {
        await db().mediaAsset.update({ where: { id: a.id }, data: { lqip } });
        return null;
      } catch (err) {
        return pgErrorCode(err);
      }
    };
    expect(await code('https://example.com/x.webp')).toBe(PG.checkViolation);
    expect(await code(`data:image/webp;base64,${'A'.repeat(3000)}`)).toBe(PG.checkViolation);
    expect(await code('data:image/webp;base64,UklGRg==')).toBeNull();
    expect(await code('')).toBeNull();
  });
});
