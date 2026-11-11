/**
 * Marquee lights (2026-11-11): the bulbs around the "Ao vivo agora" player, like a theatre
 * marquee. Pure geometry in a 1600 × 900 box (the player's 16:9); the player sits inside a 3%
 * border on every side, so it stays 16:9 and the bulbs run along the middle of that border.
 */

export const MARQUEE_W = 1600;
export const MARQUEE_H = 900;
/** the border, as a fraction of each side (the player is inset by this) */
export const MARQUEE_INSET = 0.03;
export const BULB_R = 9;
const STEP = 40;

export type Bulb = { x: number; y: number; phase: 0 | 1 | 2 };

/**
 * Bulbs clockwise from the top-left corner, each corner once, evenly spaced on every side. The
 * phase (0, 1, 2 repeating) is what makes the light run around: one phase is lit at a time.
 */
export function marqueeBulbs(): Bulb[] {
  const x0 = (MARQUEE_W * MARQUEE_INSET) / 2;
  const y0 = (MARQUEE_H * MARQUEE_INSET) / 2;
  const x1 = MARQUEE_W - x0;
  const y1 = MARQUEE_H - y0;
  const across = Math.max(1, Math.round((x1 - x0) / STEP));
  const down = Math.max(1, Math.round((y1 - y0) / STEP));
  // a bulb count divisible by 3, so the chase has no seam where the loop closes
  let along = across;
  while ((along + down) % 3) along++;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < along; i++) pts.push({ x: x0 + ((x1 - x0) * i) / along, y: y0 });
  for (let i = 0; i < down; i++) pts.push({ x: x1, y: y0 + ((y1 - y0) * i) / down });
  for (let i = 0; i < along; i++) pts.push({ x: x1 - ((x1 - x0) * i) / along, y: y1 });
  for (let i = 0; i < down; i++) pts.push({ x: x0, y: y1 - ((y1 - y0) * i) / down });
  return pts.map((p, i) => ({
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    phase: (i % 3) as 0 | 1 | 2,
  }));
}
