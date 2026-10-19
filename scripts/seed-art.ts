/**
 * Placeholder art for the development seed (12 §2 step 10): posters (960×1440) and backdrops
 * (2560×1440) composed ONLY from the brand assets (mascot line art + patterns, public/brand),
 * the same placeholder language as docs/design/r1-prototype.html. Real posters/backdrops are
 * uploaded by moderators in the dashboard. Output: PNG files, then fed through the real media
 * pipeline (src/server/media/pipeline.ts) by scripts/seed-dev.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const BRAND = join(import.meta.dirname, '../public/brand');

export type ArtSpec = {
  /** gradient: inner → outer (brand purples only) */
  c1: string;
  c2: string;
  pattern: 'padrao-1' | 'padrao-2' | 'padrao-3';
  patternColour: 'plum' | 'violet' | 'lavender';
  pose: 1 | 2 | 3 | 4;
  mascotColour: 'lilac' | 'lavender' | 'ink';
  /** mirror the mascot horizontally */
  flip?: boolean;
};

export const PALETTES: [string, string][] = [
  ['#2E2141', '#736BB2'],
  ['#241A33', '#4F3D72'],
  ['#3A2C53', '#A99DE0'],
  ['#1B1225', '#736BB2'],
  ['#2E2141', '#4F3D72'],
  ['#241A33', '#A99DE0'],
];

const b64 = (s: string) => Buffer.from(s).toString('base64');
const svgOf = (name: string) => readFileSync(join(BRAND, `${name}.svg`), 'utf8');

function viewBox(svg: string): [number, number] {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  return m ? [Number(m[1]), Number(m[2])] : [1000, 1000];
}

function compose(w: number, h: number, spec: ArtSpec, layout: 'backdrop' | 'poster'): string {
  const pattern = svgOf(`${spec.pattern}-${spec.patternColour}`);
  const mascot = svgOf(`mascote-${spec.pose}-${spec.mascotColour}`);
  const [mw, mh] = viewBox(mascot);
  const tile = layout === 'backdrop' ? 420 : 300;
  const mascotH = layout === 'backdrop' ? h * 0.58 : h * 0.5;
  const mascotW = (mascotH * mw) / mh;
  const mx = layout === 'backdrop' ? w * 0.7 - mascotW / 2 : (w - mascotW) / 2;
  const my = layout === 'backdrop' ? h * 0.16 : h * 0.3;
  const cx = layout === 'backdrop' ? '68%' : '60%';
  const flip = spec.flip ? `translate(${2 * mx + mascotW} 0) scale(-1 1)` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="bg" cx="${cx}" cy="40%" r="75%">
      <stop offset="0" stop-color="${spec.c2}"/>
      <stop offset="0.55" stop-color="${spec.c1}"/>
      <stop offset="1" stop-color="#1B1225"/>
    </radialGradient>
    <pattern id="pat" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse">
      <image width="${tile}" height="${tile}" xlink:href="data:image/svg+xml;base64,${b64(pattern)}"/>
    </pattern>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="${layout === 'backdrop' ? 14 : 10}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#pat)" opacity="0.26"/>
  <g transform="${flip}" filter="url(#glow)" opacity="0.92">
    <image x="${mx}" y="${my}" width="${mascotW}" height="${mascotH}" xlink:href="data:image/svg+xml;base64,${b64(mascot)}"/>
  </g>
</svg>`;
}

export async function renderArt(
  spec: ArtSpec,
  layout: 'backdrop' | 'poster',
  file: string,
): Promise<void> {
  const [w, h] = layout === 'backdrop' ? [2560, 1440] : [960, 1440];
  await sharp(Buffer.from(compose(w, h, spec, layout)), {
    density: 72,
    limitInputPixels: 40_000_000,
  })
    .png({ compressionLevel: 6 })
    .toFile(file);
}

/** A transparent title logo (PNG with alpha) — for one seeded movie, to exercise the logo path. */
export async function renderLogo(text: string, file: string): Promise<void> {
  const safe = text.replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="320" viewBox="0 0 1400 320">
  <text x="700" y="150" text-anchor="middle" font-family="serif" font-weight="bold" font-size="104" fill="#E5DDED" letter-spacing="4">${safe.split(' ').slice(0, 2).join(' ')}</text>
  <text x="700" y="280" text-anchor="middle" font-family="serif" font-weight="bold" font-size="104" fill="#A99DE0" letter-spacing="4">${safe.split(' ').slice(2).join(' ')}</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}
