/**
 * Theater seat map for a crowdfunding campaign (2026-11-11): the goal is a full house of
 * ROWS × COLS seats; the money raised fills them, best seats first (middle rows, centre — the way a
 * real cinema fills). Contributions whose Pix is still pending show as "reservado". A viewer who
 * contributed gets one of the taken seats marked as theirs ("seu lugar"), always the same one.
 * Pure, so the server and the tests compute the same picture. Seats are a proportion of the goal,
 * not one per person: the caption gives the number of supporters separately.
 */
import type { PublicCampaign } from './catalog/types';

export const SEAT_ROWS = 6;
export const SEAT_COLS = 10;
/** the aisle comes after this many seats in each row */
export const SEAT_AISLE_AFTER = 5;
/** entrance waves (for the staggered pop-in) */
export const SEAT_WAVES = 10;

export type SeatState = 'taken' | 'held' | 'free';
export type Seat = { row: number; col: number; state: SeatState; mine: boolean; wave: number };

const FULL_HOUSE: readonly PublicCampaign['state'][] = ['FUNDED', 'SCHEDULED', 'WATCHED'];

/** Every seat, best first: closest to the middle of the room (rows count a little more). */
export function seatOrder(rows = SEAT_ROWS, cols = SEAT_COLS): { row: number; col: number }[] {
  const midRow = (rows - 1) * 0.6; // a bit behind the centre, like real "best seats"
  const midCol = (cols - 1) / 2;
  const all: { row: number; col: number; score: number }[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++)
      all.push({ row, col, score: (col - midCol) ** 2 + 1.6 * (row - midRow) ** 2 });
  return all
    .sort((a, b) => a.score - b.score || a.row - b.row || a.col - b.col)
    .map(({ row, col }) => ({ row, col }));
}

function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export type SeatMap = {
  seats: Seat[];
  total: number;
  taken: number;
  held: number;
  /** percent of the goal raised, 0–100 (whole number, never rounded up to 100 before the goal) */
  percent: number;
};

export function seatMap(
  c: Pick<PublicCampaign, 'goalCents' | 'raisedCents' | 'remainingCents' | 'state'>,
  mineKey: string | null = null,
  rows = SEAT_ROWS,
  cols = SEAT_COLS,
): SeatMap {
  const total = rows * cols;
  const goal = Math.max(1, c.goalCents);
  const raised = Math.max(0, Math.min(c.raisedCents, goal));
  const full = FULL_HOUSE.includes(c.state) || raised >= goal;
  const percent = full ? 100 : Math.min(99, Math.floor((raised / goal) * 100));

  let taken = full ? total : Math.floor((raised / goal) * total);
  if (!full && raised > 0 && taken === 0) taken = 1; // the first real seat shows
  if (!full && taken >= total) taken = total - 1; // a full house only when the goal is met
  const pending = full ? 0 : Math.max(0, goal - raised - Math.max(0, c.remainingCents));
  let held = Math.floor((pending / goal) * total);
  if (pending > 0 && held === 0) held = 1;
  held = Math.min(held, total - taken);

  const mineAt = mineKey && taken > 0 ? fnv(mineKey) % taken : -1;
  const perWave = Math.max(1, Math.ceil((taken + held) / SEAT_WAVES));
  const byPos = new Map<string, Seat>();
  seatOrder(rows, cols).forEach(({ row, col }, i) => {
    const state: SeatState = i < taken ? 'taken' : i < taken + held ? 'held' : 'free';
    byPos.set(`${row}:${col}`, {
      row,
      col,
      state,
      mine: i === mineAt,
      wave: state === 'free' ? 0 : Math.min(SEAT_WAVES - 1, Math.floor(i / perWave)),
    });
  });
  const seats: Seat[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) seats.push(byPos.get(`${row}:${col}`)!);
  return { seats, total, taken, held, percent };
}
