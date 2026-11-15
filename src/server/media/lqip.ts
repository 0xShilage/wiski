import 'server-only';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import type { MediaRole } from '@/generated/prisma/client';
import type { MediaVariant } from '@/lib/media';
import { LQIP_PATTERN } from '@/lib/media';
import { db } from '../db';
import { mediaDir } from '../env';
import { logger } from '../log';

/**
 * Blur-up placeholders (2026-11-14): a tiny WebP of the image (24 px wide) as a data: URI. The page
 * paints it, stretched and soft, behind the real image until that arrives, so a poster or a
 * background never pops in from nothing. Opaque roles only (a logo or a badge has no "behind").
 */
export const LQIP_ROLES: readonly MediaRole[] = ['POSTER', 'BACKDROP', 'PORTRAIT'];
const WIDTH = 24;
const SAFE_NAME = /^[0-9a-f]{32}-\d{2,4}\.webp$/;

/** From an already re-encoded image (the smallest WebP). '' when it can't be made. */
export async function lqipOf(image: Buffer): Promise<string> {
  const out = await sharp(image, { limitInputPixels: 8_000_000, failOn: 'error' })
    .resize({ width: WIDTH })
    .removeAlpha()
    .webp({ quality: 35, effort: 4, smartSubsample: true })
    .toBuffer();
  const uri = `data:image/webp;base64,${out.toString('base64')}`;
  return LQIP_PATTERN.test(uri) ? uri : '';
}

/**
 * Older assets (uploaded before placeholders existed): the worker fills them in a few at a time,
 * newest first, from the smallest WebP on disk. A failure stores '' so it isn't retried forever.
 */
export async function backfillLqip(limit = 25): Promise<number> {
  const rows = await db().mediaAsset.findMany({
    where: { lqip: null, role: { in: [...LQIP_ROLES] } },
    select: { id: true, variants: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  let done = 0;
  for (const row of rows) {
    let lqip = '';
    try {
      const vs = Array.isArray(row.variants) ? (row.variants as MediaVariant[]) : [];
      const smallest = vs
        .filter((v) => v?.format === 'webp' && !v.still && typeof v.path === 'string')
        .sort((a, b) => a.w - b.w)[0];
      const name = smallest ? basename(smallest.path) : '';
      if (SAFE_NAME.test(name)) lqip = await lqipOf(await readFile(join(mediaDir(), name)));
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : 'unknown', assetId: row.id },
        'blur-up placeholder unavailable',
      );
    }
    await db().mediaAsset.updateMany({ where: { id: row.id, lqip: null }, data: { lqip } });
    done += 1;
  }
  return done;
}
