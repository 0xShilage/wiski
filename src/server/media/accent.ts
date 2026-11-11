import 'server-only';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { accentFromPixels, ACCENT_RE } from '@/lib/accent';
import type { MediaVariant } from '@/lib/media';
import { db } from '../db';
import { mediaDir } from '../env';
import { logger } from '../log';

const SAFE_NAME = /^[0-9a-f]{32}-\d{2,4}\.(?:avif|webp)$/;

/**
 * Ambient glow (2026-11-11): a poster's accent colour from an already re-encoded image (never the
 * raw upload). A 24 × 36 thumbnail is plenty for a hue.
 */
export async function accentOf(image: Buffer): Promise<string> {
  const { data, info } = await sharp(image, { limitInputPixels: 4_000_000, failOn: 'error' })
    .resize(24, 36, { fit: 'fill' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return accentFromPixels(data, info.channels);
}

/**
 * The accent of a poster uploaded before the column existed: worked out from its smallest WebP on
 * disk the first time its page is opened, then stored (only while still null). Any failure (file
 * missing, unreadable) just means no glow this time: never an error on the page.
 */
export async function ensureAccent(asset: {
  id: string;
  accent: string | null;
  variants: unknown;
}): Promise<string | null> {
  if (asset.accent !== null) return asset.accent;
  try {
    const vs = Array.isArray(asset.variants) ? (asset.variants as MediaVariant[]) : [];
    const smallest = vs
      .filter((v) => v?.format === 'webp' && typeof v.path === 'string')
      .sort((a, b) => a.w - b.w)[0];
    const name = smallest ? basename(smallest.path) : '';
    if (!SAFE_NAME.test(name)) return null;
    const accent = await accentOf(await readFile(join(mediaDir(), name)));
    if (!ACCENT_RE.test(accent)) return null;
    await db().mediaAsset.updateMany({ where: { id: asset.id, accent: null }, data: { accent } });
    return accent;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown', assetId: asset.id },
      'poster accent unavailable',
    );
    return null;
  }
}
