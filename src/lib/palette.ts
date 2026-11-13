/**
 * Paleta do filme (2026-11-13): up to five colours of a poster, most present first. Pure maths on
 * raw RGB pixels (a median-cut variant) so it can be unit-tested; the server feeds it a small thumbnail
 * (src/server/media/palette.ts). Near-identical colours are merged, so a poster with little colour
 * gets fewer swatches rather than five shades of black.
 */

export const PALETTE_SIZE = 5;
export const PALETTE_RE = /^#[0-9a-f]{6}$/;

type Px = [number, number, number];
type Box = Px[];

const hex = (c: Px) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

function channelRange(box: Box): [number, number] {
  let best = 0;
  let bestRange = -1;
  for (let ch = 0; ch < 3; ch++) {
    let lo = 255;
    let hi = 0;
    for (const p of box) {
      if (p[ch]! < lo) lo = p[ch]!;
      if (p[ch]! > hi) hi = p[ch]!;
    }
    if (hi - lo > bestRange) {
      bestRange = hi - lo;
      best = ch;
    }
  }
  return [best, bestRange];
}

function mean(box: Box): Px {
  const s: Px = [0, 0, 0];
  for (const p of box) {
    s[0] += p[0];
    s[1] += p[1];
    s[2] += p[2];
  }
  return [s[0] / box.length, s[1] / box.length, s[2] / box.length];
}

const dist = (a: Px, b: Px) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function paletteFromPixels(
  data: Uint8Array,
  channels: number,
  size = PALETTE_SIZE,
): string[] {
  const pixels: Box = [];
  for (let i = 0; i + 2 < data.length; i += channels)
    pixels.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  if (!pixels.length) return [];
  // cut into twice as many boxes as wanted, then keep the biggest distinct ones
  let boxes: Box[] = [pixels];
  while (boxes.length < size * 2) {
    let pick = -1;
    let widest = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      const [, range] = channelRange(b);
      // a box's claim to be split: how varied it is, weighted by how much of the poster it holds
      const score = range * Math.sqrt(b.length);
      if (range > 0 && score > widest) {
        widest = score;
        pick = i;
      }
    });
    if (pick < 0) break;
    const box = boxes[pick]!;
    const [ch] = channelRange(box);
    // split at the middle of the channel's range (not the median), so a colour that fills much of
    // the poster stays in one box instead of being blended with its neighbour
    let lo = 255;
    let hi = 0;
    for (const p of box) {
      if (p[ch]! < lo) lo = p[ch]!;
      if (p[ch]! > hi) hi = p[ch]!;
    }
    const mid = (lo + hi) / 2;
    const low = box.filter((p) => p[ch]! <= mid);
    const high = box.filter((p) => p[ch]! > mid);
    boxes = [...boxes.slice(0, pick), low, high, ...boxes.slice(pick + 1)];
  }
  const colours = boxes
    .map((b) => ({ c: mean(b), n: b.length }))
    .sort((a, b) => b.n - a.n || a.c[0] - b.c[0] || a.c[1] - b.c[1] || a.c[2] - b.c[2]);
  const out: Px[] = [];
  for (const { c } of colours) {
    if (out.every((o) => dist(o, c) >= 28)) out.push(c);
    if (out.length === size) break;
  }
  return out.map(hex);
}

/** A palette as the database keeps it (only valid #rrggbb, at most five). */
export function cleanPalette(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && PALETTE_RE.test(v))
    .slice(0, PALETTE_SIZE);
}
