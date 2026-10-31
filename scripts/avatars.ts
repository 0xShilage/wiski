/**
 * Profile pictures (2026-10-31): ASSETS/PROFILE_ICONS/01.png … 30.png (1000 × 1000, round, transparent
 * corners) → public/avatars/perfil-NN-{128,256}.webp. The originals stay out of git (≈ 23 MB);
 * re-run `npm run avatars` after changing one. Metadata is stripped, alpha kept.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { AVATAR_KEYS, AVATAR_PIXELS } from '../src/lib/avatars';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'ASSETS/PROFILE_ICONS');
const OUT = join(ROOT, 'public/avatars');

if (!existsSync(SRC)) {
  console.error(`avatars: ${SRC} not found`);
  process.exit(1);
}
const sources = readdirSync(SRC)
  .filter((f) => /^\d{2}\.png$/.test(f))
  .sort();
if (sources.length !== AVATAR_KEYS.length) {
  console.error(
    `avatars: expected ${AVATAR_KEYS.length} files (01.png …), found ${sources.length}`,
  );
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
for (const [i, key] of AVATAR_KEYS.entries()) {
  const file = join(SRC, `${String(i + 1).padStart(2, '0')}.png`);
  const meta = await sharp(file).metadata();
  if (meta.width !== meta.height)
    throw new Error(`${file}: not square (${meta.width}×${meta.height})`);
  for (const px of AVATAR_PIXELS) {
    await sharp(file)
      .resize(px, px, { kernel: 'lanczos3' })
      .webp({ quality: 86, alphaQuality: 100, effort: 6, smartSubsample: true })
      .toFile(join(OUT, `${key}-${px}.webp`));
  }
}
console.log(`avatars: ${AVATAR_KEYS.length} × ${AVATAR_PIXELS.join('/')} px → public/avatars`);
