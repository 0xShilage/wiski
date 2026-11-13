import 'server-only';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import type { MediaVariant } from '@/lib/media';
import { cleanPalette, paletteFromPixels } from '@/lib/palette';
import { db } from '../db';
import { mediaDir } from '../env';
import { logger } from '../log';

const SAFE_NAME = /^[0-9a-f]{32}-\d{2,4}\.(?:avif|webp)$/;

/** Paleta do filme (2026-11-13): a poster's colours from an already re-encoded image. */
export async function paletteOf(image: Buffer): Promise<string[]> {
  const { data, info } = await sharp(image, { limitInputPixels: 4_000_000, failOn: 'error' })
    .resize(48, 72, { fit: 'fill' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return paletteFromPixels(data, info.channels);
}

/**
 * The palette of a poster uploaded before the column existed: worked out from its smallest WebP on
 * disk the first time its page is opened, then stored (only while still empty). Any failure just
 * means no palette this time, never an error on the page.
 */
export async function ensurePalette(asset: {
  id: string;
  palette: string[] | null;
  variants: unknown;
}): Promise<string[]> {
  const known = cleanPalette(asset.palette);
  if (known.length) return known;
  try {
    const vs = Array.isArray(asset.variants) ? (asset.variants as MediaVariant[]) : [];
    const smallest = vs
      .filter((v) => v?.format === 'webp' && typeof v.path === 'string')
      .sort((a, b) => a.w - b.w)[0];
    const name = smallest ? basename(smallest.path) : '';
    if (!SAFE_NAME.test(name)) return [];
    const palette = cleanPalette(await paletteOf(await readFile(join(mediaDir(), name))));
    if (!palette.length) return [];
    await db().mediaAsset.updateMany({
      where: { id: asset.id, OR: [{ palette: { isEmpty: true } }, { palette: { equals: null } }] },
      data: { palette },
    });
    return palette;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown', assetId: asset.id },
      'poster palette unavailable',
    );
    return [];
  }
}
