/**
 * Bingo da live (2026-11-16, §53): one card a day per signed-in viewer (9 of the 18 items, drawn
 * by the server), the team calls items, a full line is a bingo with the day's next place. Bingos
 * show on the overlay and in chat, count in the ranking and the conquistas. Days start at 16:00 BRT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as cardRoute } from '@/app/api/v1/bingo/card/route';
import { POST as callRoute } from '@/app/api/v1/admin/bingo/calls/route';
import { PUT as itemsRoute } from '@/app/api/v1/admin/bingo/items/route';
import { bingoDay } from '@/lib/bingo';
import { callItem, myBingo, setBingoItems, staffBingo, takeCard } from '@/server/bingo/bingo';
import { achievementStats } from '@/server/community/achievements';
import { ranking } from '@/server/community/rankings';
import { db } from '@/server/db';
import { PG, pgErrorCode } from '@/server/db-errors';
import { resetEnvCache } from '@/server/env';
import { overlayChannel } from '@/server/overlay/publish';
import { redis } from '@/server/redis';
import { eraseMyAccount, exportMyData } from '@/server/users/lgpd';
import { makeUser } from '../support/db';
import { call, req, signedIn } from '../support/http';

// header.payload.signature, payload {"channel":"5f0c0ffee0ddba11c0ffee00"}
const JWT = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
  JSON.stringify({ channel: '5f0c0ffee0ddba11c0ffee00' }),
).toString('base64url')}.c2ln`;
let sent: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(async () => {
  await db().appSetting.deleteMany({ where: { key: 'alerts' } });
  const keys = await redis().keys('wf:se:said:bingo:*');
  if (keys.length) await redis().del(...keys);
  sent = [];
  vi.stubEnv('STREAMELEMENTS_JWT', JWT);
  resetEnvCache();
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    sent.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return Response.json({ ok: true });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCache();
});
const chat = () => sent.filter((s) => s.url.includes('/bot/')).map((s) => s.body.message);

/** 18:00 BRT on a day of its own, so tests don't share a bingo day. */
let dayN = 0;
const freshDay = () => new Date(Date.UTC(2031, 0, ++dayN, 21, 0));

async function staff() {
  const user = await makeUser({ role: 'MODERATOR' });
  return { actor: { id: user.id, role: user.role }, requestId: null, user };
}

async function cardFor(cells: number[], now: Date, createdAt = now) {
  const user = await makeUser();
  await db().bingoCard.create({ data: { day: bingoDay(now), userId: user.id, cells, createdAt } });
  return user;
}

/** What the "patrocinio" channel receives while `fn` runs. */
async function alerts(fn: () => Promise<unknown>) {
  const sub = redis().duplicate();
  const got: Record<string, unknown>[] = [];
  await sub.subscribe(overlayChannel('patrocinio'));
  sub.on('message', (_c, m) => got.push(JSON.parse(m) as Record<string, unknown>));
  await fn();
  for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 20));
  await sub.quit();
  return got;
}

describe('the card', () => {
  it('a signed-in viewer takes one card a day: 9 distinct items, the same one after that', async () => {
    const user = await makeUser();
    const auth = await signedIn(user);
    const take = async () => {
      const res = await call(
        cardRoute,
        req('POST', '/api/v1/bingo/card', {
          cookies: auth.cookies,
          headers: auth.headers,
          body: {},
        }),
      );
      return {
        status: res.status,
        json: (await res.json()) as { view: { card: { cells: number[] } } },
      };
    };
    const first = await take();
    expect(first.status).toBe(200);
    const cells = first.json.view.card.cells;
    expect(cells).toHaveLength(9);
    expect(new Set(cells).size).toBe(9);
    expect(cells.every((p) => p >= 1 && p <= 18)).toBe(true);
    expect((await take()).json.view.card.cells).toEqual(cells);
    expect(await db().bingoCard.count({ where: { userId: user.id } })).toBe(1);
  });

  it('needs a username and an active account', async () => {
    const now = freshDay();
    const noName = await makeUser({ username: null });
    await expect(takeCard(noName, now)).rejects.toMatchObject({ code: 'ONBOARDING_REQUIRED' });
    const suspended = await makeUser({ status: 'SUSPENDED' });
    await expect(takeCard(suspended, now)).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
  });

  it('renews at 16:00 BRT', async () => {
    const user = await makeUser();
    const before = new Date(Date.UTC(2031, 5, 10, 18, 59)); // 15:59 BRT
    const after = new Date(Date.UTC(2031, 5, 10, 19, 0)); // 16:00 BRT
    await takeCard(user, before);
    expect((await myBingo(user.id, after)).card).toBeNull();
    await takeCard(user, after);
    expect(await db().bingoCard.count({ where: { userId: user.id } })).toBe(2);
    expect((await myBingo(user.id, after)).day).toBe('2031-06-10');
    expect((await myBingo(user.id, before)).day).toBe('2031-06-09');
  });

  it('a card taken after the calls counts them: a line there is a bingo at once', async () => {
    const now = freshDay();
    const s = await staff();
    for (const p of [1, 2, 3]) await callItem(s, p, true, now);
    const user = await makeUser();
    // an RNG that never swaps: the card is 1…9, row by row
    const got = await alerts(async () => {
      const r = await takeCard(user, now, (n) => n - 1);
      expect(r.place).toBe(1);
      expect(r.view.win).toEqual({ place: 1, line: [1, 2, 3] });
    });
    expect(got[0]).toMatchObject({ type: 'bingo', username: `@${user.username}`, place: 1 });
    expect(chat()).toEqual([
      `BINGO! @${user.username} completou uma linha e é o 1º lugar de hoje! 🎉`,
    ]);
  });
});

describe('calling items', () => {
  it('a call that completes lines gives places in the order the cards were taken', async () => {
    const now = freshDay();
    const s = await staff();
    const early = await cardFor([1, 2, 3, 4, 5, 6, 7, 8, 9], now, new Date(now.getTime() - 60_000));
    const late = await cardFor([10, 1, 11, 12, 2, 13, 14, 3, 15], now); // column 2
    const none = await cardFor([4, 5, 6, 7, 8, 9, 10, 11, 12], now);
    await callItem(s, 1, true, now);
    await callItem(s, 2, true, now);
    const got = await alerts(async () => {
      const r = await callItem(s, 3, true, now);
      expect(r.winners).toBe(2);
      expect(r.view.winners.map((w) => [w.username, w.place])).toEqual([
        [early.username, 1],
        [late.username, 2],
      ]);
    });
    expect(got.map((e) => e.place)).toEqual([1, 2]);
    expect((await myBingo(late.id, now)).win).toEqual({ place: 2, line: [1, 2, 3] });
    expect((await myBingo(none.id, now)).win).toBeNull();
    // one bingo a day: another line for the same viewer changes nothing
    for (const p of [4, 5]) await callItem(s, p, true, now);
    expect((await callItem(s, 6, true, now)).winners).toBe(1); // only "none" (row 4 5 6)
    expect(await db().bingoWin.count({ where: { day: bingoDay(now) } })).toBe(3);
    expect(
      await db().bingoWin.findUnique({
        where: { day_userId: { day: bingoDay(now), userId: none.id } },
      }),
    ).toMatchObject({ place: 3 });
  });

  it('calling twice changes nothing; a call that made someone win cannot be taken back', async () => {
    const now = freshDay();
    const s = await staff();
    await cardFor([1, 2, 3, 4, 5, 6, 7, 8, 9], now);
    for (const p of [1, 2, 3, 18]) await callItem(s, p, true, now);
    await callItem(s, 18, true, now);
    expect((await staffBingo(now)).calls.map((c) => c.position)).toEqual([1, 2, 3, 18]);
    await expect(callItem(s, 2, false, now)).rejects.toMatchObject({ code: 'BINGO_CALL_IN_WIN' });
    await callItem(s, 18, false, now);
    expect((await staffBingo(now)).calls.map((c) => c.position)).toEqual([1, 2, 3]);
    const logs = await db().auditLog.findMany({
      where: { action: 'bingo.call', actorId: s.user.id },
      orderBy: { id: 'asc' },
    });
    expect(logs.map((l) => l.metadata)).toEqual([
      ...[1, 2, 3, 18].map((position) => ({
        position,
        called: true,
        day: '2031-01-' + String(dayN).padStart(2, '0'),
      })),
      { position: 18, called: false, day: '2031-01-' + String(dayN).padStart(2, '0') },
    ]);
  });

  it('only staff call; the route checks the position', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    const auth = await signedIn(mod);
    const res = await call(
      callRoute,
      req('POST', '/api/v1/admin/bingo/calls', {
        cookies: auth.cookies,
        headers: auth.headers,
        body: { position: 19, called: true },
      }),
    );
    expect(res.status).toBe(422);
  });

  it('more than three winners at once: three alerts, the rest summed up in chat', async () => {
    const now = freshDay();
    const s = await staff();
    for (let i = 0; i < 5; i++) {
      await cardFor([1, 2, 3, 4, 5, 6, 7, 8, 9], now, new Date(now.getTime() - (10 - i) * 1000));
    }
    await callItem(s, 1, true, now);
    await callItem(s, 2, true, now);
    const got = await alerts(async () => {
      expect((await callItem(s, 3, true, now)).winners).toBe(5);
    });
    expect(got).toHaveLength(3);
    expect(chat()).toHaveLength(4);
    expect(chat().at(-1)).toBe('E mais 2 pessoas também fizeram bingo agora! 🎉');
  });
});

describe('the items', () => {
  it('18 placeholders until the team writes them; texts are cleaned and audited', async () => {
    const s = await staff();
    const texts = Array.from({ length: 18 }, (_, i) => `  Coisa ${i + 1}  `);
    texts[4] = 'Alguém pede\u202e Dark\u200b';
    const items = await setBingoItems(s, texts);
    expect(items[0]).toEqual({ position: 1, text: 'Coisa 1' });
    expect(items[4]!.text).not.toMatch(/[\u202e\u200b]/);
    await expect(
      setBingoItems(
        s,
        texts.map((t, i) => (i === 2 ? ' ' : t)),
      ),
    ).rejects.toMatchObject({
      status: 422,
    });
    const auth = await signedIn(s.user);
    const res = await call(
      itemsRoute,
      req('PUT', '/api/v1/admin/bingo/items', {
        cookies: auth.cookies,
        headers: auth.headers,
        body: { items: texts.slice(0, 17) },
      }),
    );
    expect(res.status).toBe(422);
    const log = await db().auditLog.findFirst({
      where: { action: 'bingo.items', actorId: s.user.id },
    });
    expect((log?.metadata as { positions: number[] }).positions).toHaveLength(18);
  });
});

describe('ranking, conquistas and data', () => {
  it('bingos count in the ranking and the conquistas', async () => {
    const s = await staff();
    const user = await makeUser();
    // two bingo days: ahead of everyone else here, who have one each
    for (const now of [freshDay(), freshDay()]) {
      await db().bingoCard.create({
        data: { day: bingoDay(now), userId: user.id, cells: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
      });
      for (const p of [7, 8, 9]) await callItem(s, p, true, now);
    }
    const board = await ranking('bingo', 'geral');
    expect(board[0]).toMatchObject({ username: user.username, value: 2, position: 1 });
    const full = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    expect((await achievementStats(full)).bingoWins).toBe(2);
  });

  it('LGPD: exported, and erasing the account takes the cards and bingos', async () => {
    const now = freshDay();
    const s = await staff();
    const user = await cardFor([1, 2, 3, 4, 5, 6, 7, 8, 9], now);
    for (const p of [1, 5, 9]) await callItem(s, p, true, now);
    const full = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    const data = await exportMyData(full, null);
    expect(data.bingo.cards).toHaveLength(1);
    expect(data.bingo.wins).toEqual([expect.objectContaining({ place: 1, line: [1, 5, 9] })]);
    await eraseMyAccount(full, full.username!, null);
    expect(await db().bingoCard.count({ where: { userId: user.id } })).toBe(0);
    expect(await db().bingoWin.count({ where: { userId: user.id } })).toBe(0);
  });

  it('the database keeps cards to 9 distinct items and positions to 1…18', async () => {
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
        return null;
      } catch (err) {
        return pgErrorCode(err);
      }
    };
    const now = freshDay();
    const day = bingoDay(now);
    const u = await makeUser();
    const card = (cells: number[]) => db().bingoCard.create({ data: { day, userId: u.id, cells } });
    expect(await code(card([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(PG.checkViolation);
    expect(await code(card([1, 1, 3, 4, 5, 6, 7, 8, 9]))).toBe(PG.checkViolation);
    expect(await code(card([0, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(PG.checkViolation);
    expect(await code(card([1, 2, 3, 4, 5, 6, 7, 8, 19]))).toBe(PG.checkViolation);
    expect(await code(db().bingoCall.create({ data: { day, position: 19 } }))).toBe(
      PG.checkViolation,
    );
    expect(await code(db().bingoItem.create({ data: { position: 19, text: 'x' } }))).toBe(
      PG.checkViolation,
    );
    expect(await db().bingoItem.count()).toBe(18);
  });
});
