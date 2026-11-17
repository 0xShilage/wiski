/**
 * Bingo (2026-11-16, §53): things that happen in the live chat and on stream. Shared by the server
 * and the pages. No zod, no I/O.
 *
 * There are 18 items (positions 1…18); each viewer's card is 9 of them on a 3×3 grid, drawn at
 * random. The team calls an item when it happens; a row, a column or a diagonal of called items is
 * a bingo. The cards and the calls renew every day at 16:00 (America/Sao_Paulo).
 */
import type { NameBadge } from './name-badge';

export const BINGO_ITEMS = 18;
export const BINGO_CELLS = 9;
export const BINGO_ITEM_MAX = 80;
/** the cards renew every day at this hour, America/Sao_Paulo */
export const BINGO_RESET_HOUR = 16;

/** Rows, columns and diagonals of a 3×3 card, as cell indexes 0…8 (row by row). */
export const BINGO_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/**
 * The first completed line of a card (its three positions, in cell order), or null. `cells` are
 * the card's positions row by row; `called` the positions called today.
 */
export function completedLine(
  cells: readonly number[],
  called: ReadonlySet<number> | readonly number[],
): [number, number, number] | null {
  const has = Array.isArray(called) ? new Set(called) : (called as ReadonlySet<number>);
  for (const [a, b, c] of BINGO_LINES) {
    const line = [cells[a]!, cells[b]!, cells[c]!] as [number, number, number];
    if (line.every((p) => has.has(p))) return line;
  }
  return null;
}

/** The cells of a card that are in a line, for highlighting (indexes 0…8). */
export function lineCells(cells: readonly number[], line: readonly number[] | null): number[] {
  if (!line) return [];
  return cells.flatMap((p, i) => (line.includes(p) ? [i] : []));
}

const BRT_OFFSET_MS = 3 * 3_600_000; // America/Sao_Paulo: fixed −03:00 (no DST since 2019)
const DAY_MS = 86_400_000;

/**
 * The bingo day of an instant: days start at 16:00 BRT and are named by the BRT calendar day they
 * started on (a Date at UTC midnight, as Postgres DATE values come back).
 */
export function bingoDay(now: Date): Date {
  const shifted = new Date(now.getTime() - BRT_OFFSET_MS - BINGO_RESET_HOUR * 3_600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** When the cards renew next (the start of the following bingo day). */
export function nextBingoReset(now: Date): Date {
  return new Date(bingoDay(now).getTime() + DAY_MS + BINGO_RESET_HOUR * 3_600_000 + BRT_OFFSET_MS);
}

/** "hoje às 16h" / "amanhã às 16h", in BRT. */
export function bingoResetText(nextAt: string | Date, now: Date = new Date()): string {
  const at = typeof nextAt === 'string' ? new Date(nextAt) : nextAt;
  const day = (d: Date) => Math.floor((d.getTime() - BRT_OFFSET_MS) / DAY_MS);
  return day(at) - day(now) <= 0
    ? `hoje às ${BINGO_RESET_HOUR}h`
    : `amanhã às ${BINGO_RESET_HOUR}h`;
}

/** "1º", "2º"… */
export const placeText = (place: number) => `${place}º`;

/** The day as "16/11" (it is a UTC-midnight date). */
export function bingoDayText(day: string | Date): string {
  const d = typeof day === 'string' ? new Date(day) : day;
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ── what the pages get ──

export type BingoItemView = { position: number; text: string };
export type BingoWinner = {
  username: string;
  avatarKey: string | null;
  place: number;
  wonAt: string;
  badge: NameBadge | null;
};
export type MyBingo = {
  /** the bingo day (YYYY-MM-DD, the BRT day it started on) */
  day: string;
  nextReset: string;
  items: BingoItemView[];
  /** positions called today, in the order they were called */
  called: number[];
  card: { cells: number[]; createdAt: string } | null;
  win: { place: number; line: number[] } | null;
  winners: BingoWinner[];
};

export type StaffBingo = {
  day: string;
  nextReset: string;
  items: BingoItemView[];
  calls: { position: number; calledAt: string; calledBy: string | null }[];
  cards: number;
  winners: BingoWinner[];
};
