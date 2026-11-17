import 'server-only';
import { randomInt } from 'node:crypto';
import type { Prisma, Role, User } from '@/generated/prisma/client';
import {
  BINGO_CELLS,
  BINGO_ITEM_MAX,
  BINGO_ITEMS,
  bingoDay,
  completedLine,
  nextBingoReset,
  type BingoItemView,
  type BingoWinner,
  type MyBingo,
  type StaffBingo,
} from '@/lib/bingo';
import { audit } from '../audit/audit';
import { nameBadgeOf, nameBadgeUserSelect } from '../community/name-badge';
import { db } from '../db';
import { HttpError, Problems } from '../http/problem';
import { logger } from '../log';
import { codePointLength, plainText } from '../text/sanitize';
import { announceBingo } from './announce';

/**
 * Bingo (2026-11-16, docs/phase-6/README.md §53). A signed-in viewer takes one card a day: 9 of
 * the 18 items, drawn by the server (crypto RNG) on a 3×3 grid. The team calls an item in
 * Admin › Bingo when it happens in the chat or on stream; a row, column or diagonal of called items
 * is a bingo, found by the server at the call (or when the card is taken after the calls). Each
 * bingo gets the day's next place (1º, 2º…), shows on the overlay and in chat, counts for the
 * "Bingo" ranking and the conquistas. Everything renews at 16:00 BRT.
 *
 * Calls and new cards update the day's BingoRound row first, so they run one at a time per day and
 * places are handed out in order.
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };
type Viewer = Pick<User, 'id' | 'username' | 'status' | 'role'>;
type Tx = Prisma.TransactionClient;

/** winners shown on the page (the ranking keeps the rest) */
const WINNERS_SHOWN = 30;

export const BingoProblems = {
  onboarding: () =>
    new HttpError(409, 'ONBOARDING_REQUIRED', 'Escolha seu nome de usuário antes de jogar.'),
  suspended: () =>
    new HttpError(403, 'ACCOUNT_SUSPENDED', 'Sua conta está suspensa e não pode jogar o bingo.'),
  inWin: () =>
    new HttpError(
      409,
      'BINGO_CALL_IN_WIN',
      'Este item já fez alguém ganhar hoje e não pode ser desmarcado.',
    ),
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Fisher–Yates with the crypto RNG: 9 distinct positions in 1…18. */
export function drawCells(rng: (n: number) => number = randomInt): number[] {
  const all = Array.from({ length: BINGO_ITEMS }, (_, i) => i + 1);
  for (let i = all.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  return all.slice(0, BINGO_CELLS);
}

export async function bingoItems(): Promise<BingoItemView[]> {
  return db().bingoItem.findMany({
    orderBy: { position: 'asc' },
    select: { position: true, text: true },
  });
}

async function winners(day: Date): Promise<BingoWinner[]> {
  const rows = await db().bingoWin.findMany({
    where: { day, user: { status: 'ACTIVE', username: { not: null } } },
    orderBy: { place: 'asc' },
    take: WINNERS_SHOWN,
    select: {
      place: true,
      wonAt: true,
      user: { select: { username: true, avatarKey: true, ...nameBadgeUserSelect } },
    },
  });
  return rows.map((w) => ({
    username: w.user.username!,
    avatarKey: w.user.avatarKey,
    place: w.place,
    wonAt: w.wonAt.toISOString(),
    badge: nameBadgeOf(w.user),
  }));
}

async function calledToday(day: Date): Promise<number[]> {
  const rows = await db().bingoCall.findMany({
    where: { day },
    orderBy: [{ calledAt: 'asc' }, { position: 'asc' }],
    select: { position: true },
  });
  return rows.map((r) => r.position);
}

/** What the /bingo page shows (a guest sees the calls and the winners, without a card). */
export async function myBingo(userId: string | null, now = new Date()): Promise<MyBingo> {
  const day = bingoDay(now);
  const [items, called, card, win, list] = await Promise.all([
    bingoItems(),
    calledToday(day),
    userId
      ? db().bingoCard.findUnique({
          where: { day_userId: { day, userId } },
          select: { cells: true, createdAt: true },
        })
      : null,
    userId
      ? db().bingoWin.findUnique({
          where: { day_userId: { day, userId } },
          select: { place: true, line: true },
        })
      : null,
    winners(day),
  ]);
  return {
    day: isoDay(day),
    nextReset: nextBingoReset(now).toISOString(),
    items,
    called,
    card: card ? { cells: card.cells, createdAt: card.createdAt.toISOString() } : null,
    win,
    winners: list,
  };
}

/** The day's row, locked until the transaction ends (the day's mutex). */
async function lockRound(t: Tx, day: Date): Promise<number> {
  await t.bingoRound.createMany({ data: [{ day }], skipDuplicates: true });
  const r = await t.bingoRound.update({
    where: { day },
    data: { winners: { increment: 0 } },
    select: { winners: true },
  });
  return r.winners;
}

type NewWin = { userId: string; username: string | null; place: number };

/** Records the wins (in order) and moves the round's counter. */
async function recordWins(
  t: Tx,
  day: Date,
  taken: number,
  found: { userId: string; username: string | null; line: number[] }[],
  now: Date,
): Promise<NewWin[]> {
  const out: NewWin[] = [];
  for (const f of found) {
    const place = taken + out.length + 1;
    await t.bingoWin.create({
      data: { day, userId: f.userId, place, line: f.line, wonAt: now },
    });
    out.push({ userId: f.userId, username: f.username, place });
  }
  if (out.length) {
    await t.bingoRound.update({ where: { day }, data: { winners: taken + out.length } });
  }
  return out;
}

async function announce(day: Date, wins: NewWin[]) {
  if (!wins.length) return;
  try {
    await announceBingo(day, wins);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'bingo announce failed');
  }
}

/**
 * The viewer's card for today: drawn on the first call, the same one after that. A card taken
 * after some calls already counts them (a line there is a bingo at once).
 */
export async function takeCard(
  user: Viewer,
  now = new Date(),
  rng: (n: number) => number = randomInt,
): Promise<{ view: MyBingo; place: number | null }> {
  if (!user.username) throw BingoProblems.onboarding();
  if (user.status !== 'ACTIVE') throw BingoProblems.suspended();
  const day = bingoDay(now);
  const wins = await db().$transaction(async (t) => {
    const taken = await lockRound(t, day);
    const existing = await t.bingoCard.findUnique({
      where: { day_userId: { day, userId: user.id } },
      select: { id: true },
    });
    if (existing) return [];
    const cells = drawCells(rng);
    await t.bingoCard.create({ data: { day, userId: user.id, cells, createdAt: now } });
    const called = await t.bingoCall.findMany({ where: { day }, select: { position: true } });
    const line = completedLine(
      cells,
      called.map((c) => c.position),
    );
    if (!line) return [];
    return recordWins(t, day, taken, [{ userId: user.id, username: user.username, line }], now);
  });
  await announce(day, wins);
  return { view: await myBingo(user.id, now), place: wins[0]?.place ?? null };
}

// ── staff (Admin › Bingo) ──

export async function staffBingo(now = new Date()): Promise<StaffBingo> {
  const day = bingoDay(now);
  const [items, calls, cards, list] = await Promise.all([
    bingoItems(),
    db().bingoCall.findMany({
      where: { day },
      orderBy: [{ calledAt: 'asc' }, { position: 'asc' }],
      select: { position: true, calledAt: true, calledBy: { select: { username: true } } },
    }),
    db().bingoCard.count({ where: { day } }),
    winners(day),
  ]);
  return {
    day: isoDay(day),
    nextReset: nextBingoReset(now).toISOString(),
    items,
    calls: calls.map((c) => ({
      position: c.position,
      calledAt: c.calledAt.toISOString(),
      calledBy: c.calledBy?.username ?? null,
    })),
    cards,
    winners: list,
  };
}

/**
 * Calls an item (or takes a call back). A call finds every card of today with that item whose
 * owner hasn't won yet and now has a line: each is a bingo, in the order the cards were taken. A
 * call that made someone win can't be taken back. Calling twice changes nothing.
 */
export async function callItem(
  ctx: Ctx,
  position: number,
  called: boolean,
  now = new Date(),
): Promise<{ view: StaffBingo; winners: number }> {
  if (!Number.isInteger(position) || position < 1 || position > BINGO_ITEMS) {
    throw Problems.notFound();
  }
  const day = bingoDay(now);
  const wins = await db().$transaction(async (t) => {
    const taken = await lockRound(t, day);
    const current = await t.bingoCall.findUnique({
      where: { day_position: { day, position } },
      select: { position: true },
    });
    if (called === !!current) return [];
    if (!called) {
      const used = await t.bingoWin.count({ where: { day, line: { has: position } } });
      if (used > 0) throw BingoProblems.inWin();
      await t.bingoCall.delete({ where: { day_position: { day, position } } });
    } else {
      await t.bingoCall.create({
        data: { day, position, calledById: ctx.actor.id, calledAt: now },
      });
    }
    await audit(
      {
        action: 'bingo.call',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'BingoItem',
        targetId: String(position),
        metadata: { position, called, day: isoDay(day) },
      },
      t,
    );
    if (!called) return [];
    const calls = new Set(
      (await t.bingoCall.findMany({ where: { day }, select: { position: true } })).map(
        (c) => c.position,
      ),
    );
    const cards = await t.bingoCard.findMany({
      where: {
        day,
        cells: { has: position },
        user: { status: 'ACTIVE', bingoWins: { none: { day } } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { userId: true, cells: true, user: { select: { username: true } } },
    });
    const found = cards.flatMap((c) => {
      const line = completedLine(c.cells, calls);
      return line ? [{ userId: c.userId, username: c.user.username, line }] : [];
    });
    return recordWins(t, day, taken, found, now);
  });
  await announce(day, wins);
  return { view: await staffBingo(now), winners: wins.length };
}

/** Renames the 18 items (the list the team writes; placeholders until then). */
export async function setBingoItems(ctx: Ctx, texts: string[]): Promise<BingoItemView[]> {
  if (texts.length !== BINGO_ITEMS) throw Problems.validation([{ path: 'items', message: '18' }]);
  const clean = texts.map((raw, i) => {
    const text = plainText(raw);
    if (!text || codePointLength(text) > BINGO_ITEM_MAX) {
      throw Problems.validation([
        {
          path: `items.${i}`,
          message: `Escreva o item ${i + 1} com até ${BINGO_ITEM_MAX} caracteres.`,
        },
      ]);
    }
    return text;
  });
  await db().$transaction(async (t) => {
    const before = await t.bingoItem.findMany({ select: { position: true, text: true } });
    const was = new Map(before.map((b) => [b.position, b.text]));
    const changed: number[] = [];
    for (let i = 0; i < BINGO_ITEMS; i++) {
      const position = i + 1;
      if (was.get(position) === clean[i]) continue;
      await t.bingoItem.update({
        where: { position },
        data: { text: clean[i]!, updatedById: ctx.actor.id },
      });
      changed.push(position);
    }
    if (!changed.length) return;
    await audit(
      {
        action: 'bingo.items',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'BingoItem',
        targetId: 'all',
        metadata: { positions: changed },
      },
      t,
    );
  });
  return bingoItems();
}

/** Bingo wins of a viewer (the conquistas and the profile). */
export function bingoWinCount(userId: string): Promise<number> {
  return db().bingoWin.count({ where: { userId } });
}
