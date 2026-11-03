/**
 * The Links page picture (2026-11-03): ASSETS/LINKS_ICON.png (400 × 400, round, transparent
 * corners, lavender glow) → public/brand/links-iara-256.webp (shown at 120 CSS px, sharp at 2×).
 * Re-run `npm run links-photo` after replacing the PNG. Metadata is stripped, alpha kept.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { LINKS_PHOTO_PX } from '../src/lib/links';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'ASSETS/LINKS_ICON.png');
const OUT = join(ROOT, 'public/brand');

if (!existsSync(SRC)) {
  console.error(`links-photo: ${SRC} not found`);
  process.exit(1);
}
const meta = await sharp(SRC).metadata();
if (meta.width !== meta.height)
  throw new Error(`${SRC}: not square (${meta.width}×${meta.height})`);
mkdirSync(OUT, { recursive: true });
await sharp(SRC)
  .resize(LINKS_PHOTO_PX, LINKS_PHOTO_PX, { kernel: 'lanczos3' })
  .webp({ quality: 86, alphaQuality: 100, effort: 6, smartSubsample: true })
  .toFile(join(OUT, `links-iara-${LINKS_PHOTO_PX}.webp`));
console.log(`links-photo: ${LINKS_PHOTO_PX} px → public/brand/links-iara-${LINKS_PHOTO_PX}.webp`);
