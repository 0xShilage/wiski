import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { svgEntries } from '../../scripts/brand-map';
import { buildLogoGeometry } from '../../scripts/logo';
import { AVATAR_KEYS, AVATAR_PIXELS } from '@/lib/avatars';

const ROOT = join(import.meta.dirname, '../..');
const file = (p: string) => join(ROOT, p);

describe('brand pipeline output', () => {
  it('maps all 55 SVGs to ASCII slugs that exist (svg + png)', () => {
    const entries = svgEntries();
    expect(entries).toHaveLength(55);
    for (const e of entries) {
      expect(e.slug).toMatch(/^[a-z0-9-]+$/);
      expect(existsSync(file(`public/brand/${e.slug}.svg`))).toBe(true);
      expect(existsSync(file(`public/brand/${e.slug}.png`))).toBe(true);
    }
  });

  it('processed SVGs carry no <style>, scripts or external references', () => {
    for (const e of svgEntries()) {
      const svg = readFileSync(file(`public/brand/${e.slug}.svg`), 'utf8');
      expect(svg).not.toMatch(/<style|<script|foreignObject|\son\w+=|href="(?!#)/i);
    }
  });

  it('every avatar preset is built: square WebP at 128 and 256 px, alpha kept, small', async () => {
    for (const key of AVATAR_KEYS) {
      for (const px of AVATAR_PIXELS) {
        const path = file(`public/avatars/${key}-${px}.webp`);
        expect(existsSync(path), path).toBe(true);
        const meta = await sharp(path).metadata();
        expect(meta, path).toMatchObject({ format: 'webp', width: px, height: px, hasAlpha: true });
        expect(meta.size ?? readFileSync(path).length, path).toBeLessThan(
          px === 128 ? 20_000 : 60_000,
        );
      }
    }
  });
});

describe('logo', () => {
  it('committed logo SVG is up to date with the font (regenerate with npm run brand:logo)', async () => {
    const geo = await buildLogoGeometry(ROOT);
    for (const colour of ['ink', 'lilac', 'lavender']) {
      const svg = readFileSync(file(`public/brand/logo-wiski-${colour}.svg`), 'utf8');
      expect(svg).toContain(`viewBox="${geo.viewBox.join(' ')}"`);
      expect(svg).toContain(`d="${geo.d}"`);
    }
  });
});

describe('favicon set', () => {
  it('favicon.ico holds 16/32/48 PNG images', () => {
    const ico = readFileSync(file('src/app/favicon.ico'));
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    const sizes = [0, 1, 2].map((i) => ico.readUInt8(6 + i * 16));
    expect(sizes).toEqual([16, 32, 48]);
    const off = ico.readUInt32LE(6 + 12);
    expect(ico.subarray(off, off + 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('icon-512: ink rounded tile (transparent corners), mark centred (panel B)', async () => {
    const { data, info } = await sharp(file('public/brand/icon-512.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) =>
      Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4));
    expect(px(2, 2)[3]).toBe(0); // rounded corner
    expect(px(256, 30)).toEqual([0x1b, 0x12, 0x25, 255]); // ink tile
    const maskable = await sharp(file('public/brand/icon-maskable-512.png'))
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(Array.from(maskable.subarray(0, 4))).toEqual([0x1b, 0x12, 0x25, 255]); // full bleed
  });
});

describe('fonts', () => {
  it.each([
    'poppins-400',
    'poppins-500',
    'poppins-600',
    'poppins-700',
    'escargoth',
    'black-rockie',
  ])('%s.woff2 is a WOFF2 subset', (name) => {
    const buf = readFileSync(file(`src/app/fonts/${name}.woff2`));
    expect(buf.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(buf.length).toBeLessThan(40 * 1024);
  });
});
