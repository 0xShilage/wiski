/**
 * Favicon set (06 §8, favicon-preview.png panel B): ASSETS/PNG - ICONS/favicon.png placed
 * UNCHANGED (no recolouring/cropping; only scaled) on an ink (#1B1225) rounded-square tile, so
 * the lilac mark stays visible on light browser tabs.
 *
 *   src/app/favicon.ico (16/32/48) · src/app/icon.png (32) · src/app/apple-icon.png (180)
 *   public/brand/icon-192.png · icon-512.png · icon-maskable-512.png
 *   src/app/opengraph-image.png (1200×630: logo + mascot)
 *
 * Run: npm run brand:icons   (after brand:assets and brand:logo)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { PALETTE } from './brand-map';

const ROOT = join(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'ASSETS/PNG - ICONS/favicon.png');

type TileOptions = { radius: number; markWidth: number };
const ROUNDED: TileOptions = { radius: 0.22, markWidth: 0.84 }; // panel B
const FULL_BLEED: TileOptions = { radius: 0, markWidth: 0.8 }; // iOS masks corners itself
const MASKABLE: TileOptions = { radius: 0, markWidth: 0.7 }; // mark inside the 80 % safe circle

export async function tile(size: number, { radius, markWidth }: TileOptions): Promise<Buffer> {
  const mark = await sharp(SOURCE)
    .resize({ width: Math.round(size * markWidth), kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const { width = 0, height = 0 } = await sharp(mark).metadata();
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${PALETTE.ink}"/></svg>`,
  );
  return sharp(bg)
    .composite([
      { input: mark, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** ICO container with PNG payloads (supported by every current browser and Windows ≥ Vista). */
export function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

async function openGraph(): Promise<Buffer> {
  const W = 1200;
  const H = 630;
  const logo = await sharp(await readFile(join(ROOT, 'public/brand/logo-wiski-lilac.svg')), {
    density: 300,
  })
    .resize({ width: 560 })
    .png()
    .toBuffer();
  const mascot = await sharp(await readFile(join(ROOT, 'public/brand/mascote-1-lavender.svg')), {
    density: 300,
  })
    .resize({ height: 470 })
    .png()
    .toBuffer();
  const pattern = await sharp(await readFile(join(ROOT, 'public/brand/padrao-2-plum.svg')), {
    density: 150,
  })
    .resize({ width: W, height: W })
    .extract({ left: 0, top: 0, width: W, height: H })
    .png()
    .toBuffer();
  // Pattern at ~20 % opacity: multiply its alpha channel (dest-in with a constant alpha tile).
  const faded = await sharp(pattern)
    .composite([
      {
        input: Buffer.from([255, 255, 255, 51]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();
  const logoMeta = await sharp(logo).metadata();
  const mascotMeta = await sharp(mascot).metadata();
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PALETTE.ink}"/></svg>`,
  );
  return sharp(bg)
    .composite([
      { input: faded, left: 0, top: 0, blend: 'over' },
      { input: logo, left: 80, top: Math.round((H - (logoMeta.height ?? 0)) / 2) },
      {
        input: mascot,
        left: W - (mascotMeta.width ?? 0) - 70,
        top: Math.round((H - (mascotMeta.height ?? 0)) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main(): Promise<void> {
  const app = join(ROOT, 'src/app');
  const brand = join(ROOT, 'public/brand');
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(
    sizes.map(async (size) => ({ size, png: await tile(size, ROUNDED) })),
  );
  await writeFile(join(app, 'favicon.ico'), ico(pngs));
  await writeFile(join(app, 'icon.png'), await tile(32, ROUNDED));
  await writeFile(join(app, 'apple-icon.png'), await tile(180, FULL_BLEED));
  await writeFile(join(brand, 'icon-192.png'), await tile(192, ROUNDED));
  await writeFile(join(brand, 'icon-512.png'), await tile(512, ROUNDED));
  await writeFile(join(brand, 'icon-maskable-512.png'), await tile(512, MASKABLE));
  await writeFile(join(app, 'opengraph-image.png'), await openGraph());
  await writeFile(join(app, 'opengraph-image.alt.txt'), 'Wiski — logo e mascote');
  console.log(
    'icons: favicon.ico (16/32/48), icon.png, apple-icon.png, icon-192/512, maskable-512, opengraph-image.png',
  );
}

if (process.argv[1]?.endsWith('icons.ts')) await main();
