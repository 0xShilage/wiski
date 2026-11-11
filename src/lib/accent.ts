/**
 * Ambient glow (2026-11-11): the accent colour of a poster. Pure maths on raw RGB pixels so it can
 * be unit-tested; the server feeds it a tiny thumbnail (src/server/media/accent.ts).
 *
 * The most vivid hue wins, not the most common colour: a poster that is mostly black with a red
 * title glows red. The colour is then pulled into a band that reads as light on the ink
 * background (never muddy, never neon-white). A poster with no real colour gets the brand
 * lavender.
 */

export const DEFAULT_ACCENT = '#a99de0';
export const ACCENT_RE = /^#[0-9a-f]{6}$/;

const BINS = 24; // 15° each

function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [hsv(r, g, b)[0], s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const hex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v + m)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `data`: raw interleaved pixels, `channels` per pixel (3 or 4; alpha ignored). */
export function accentFromPixels(data: Uint8Array, channels: number): string {
  const n = Math.floor(data.length / channels);
  if (!n) return DEFAULT_ACCENT;
  const weight = new Float64Array(BINS);
  const sums = Array.from({ length: BINS }, () => [0, 0, 0]);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * channels]! / 255;
    const g = data[i * channels + 1]! / 255;
    const b = data[i * channels + 2]! / 255;
    const [h, s, v] = hsv(r, g, b);
    if (v < 0.18 || s < 0.22) continue; // near black, grey or white: no colour to speak of
    const w = s * s * v;
    const bin = Math.floor(h / (360 / BINS)) % BINS;
    weight[bin]! += w;
    const sum = sums[bin]!;
    sum[0]! += r * w;
    sum[1]! += g * w;
    sum[2]! += b * w;
    total += w;
  }
  // not enough colour on the poster (black-and-white, mostly grey): the brand colour
  if (total < n * 0.012) return DEFAULT_ACCENT;
  // the strongest hue, counting its two neighbours (a hue split across a bin edge still wins)
  let best = 0;
  let bestW = -1;
  for (let i = 0; i < BINS; i++) {
    const w = weight[(i + BINS - 1) % BINS]! + weight[i]! * 2 + weight[(i + 1) % BINS]!;
    if (w > bestW) [best, bestW] = [i, w];
  }
  let [r, g, b, w] = [0, 0, 0, 0];
  for (const i of [(best + BINS - 1) % BINS, best, (best + 1) % BINS]) {
    r += sums[i]![0]!;
    g += sums[i]![1]!;
    b += sums[i]![2]!;
    w += weight[i]!;
  }
  const [h, s, l] = rgbToHsl(r / w, g / w, b / w);
  return hslToHex(h, clamp(s, 0.45, 0.85), clamp(l, 0.55, 0.68));
}
