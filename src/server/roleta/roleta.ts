import 'server-only';
import { randomInt } from 'node:crypto';
import type { Prisma, Role, User } from '@/generated/prisma/client';
import {
  nextRoletaReset,
  prizeForDraw,
  PRIZE_LABEL,
  ROLETA_COUPON_BPS,
  ROLETA_COUPON_DAYS,
  ROLETA_DRAW_SPACE,
  ROLETA_SPINS_PER_DAY,
  roletaPeriod,
  slotForPrize,
  type RoletaPrize,
  type RoletaPrizeStatus,
} from '@/lib/roleta';
import { audit } from '../audit/audit';
import { db } from '../db';
import { pgErrorCode, PG } from '../db-errors';
import { HttpError, Problems } from '../http/problem';

/**
 * Roleta, the wheel of fortune (2026-11-04, docs/phase-6/README.md §11). A signed-in viewer has
 * 5 spins a day; they renew at 17:00 BRT and don't carry over. The server draws every spin
 * (crypto RNG, exact odds in src/lib/roleta.ts) and the page only animates the wheel to the slice
 * it was told. A coupon becomes a personal 30 % voucher at once; movies and Twitch VIP are given
 * by hand, from Admin › Roleta, where staff see every prize (never the "Nada" spins).
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };
type Viewer = Pick<User, 'id' | 'username' | 'status' | 'role'>;

const OPEN_KEY = 'roleta.open';
/** "Nada" spins are only needed to count today's spins; older ones go (prizes stay). */
export const ROLETA_NADA_RETENTION_MS = 30 * 86_400_000;
const DAY_MS = 86_400_000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TWITCH_LOGIN = /^[a-z0-9_]{4,25}$/;

export const RoletaProblems = {
  onboarding: () =>
    new HttpError(409, 'ONBOARDING_REQUIRED', 'Escolha seu nome de usuário antes de girar.'),
  suspended: () =>
    new HttpError(403, 'ACCOUNT_SUSPENDED', 'Sua conta está suspensa e não pode girar a roleta.'),
  closed: () =>
    new HttpError(409, 'ROLETA_CLOSED', 'A roleta está fechada agora. Volte mais tarde.'),
  noSpins: () =>
    new HttpError(
      409,
      'ROLETA_NO_SPINS',
      'Seus giros de hoje acabaram. Novos giros todo dia às 17h.',
    ),
  busy: () => new HttpError(409, 'ROLETA_BUSY', 'Um giro já está em andamento. Tente de novo.'),
  changed: () =>
    new HttpError(
      409,
      'ROLETA_CHANGED',
      'Este prêmio já foi atualizado por outra pessoa. Recarregue.',
    ),
  notPending: () =>
    new HttpError(409, 'ROLETA_NOT_PENDING', 'Este prêmio já foi entregue ou cancelado.'),
  streamerOnly: () =>
    new HttpError(403, 'ROLETA_STREAMER_ONLY', 'Só o streamer pode cancelar um prêmio.'),
  badMove: () =>
    new HttpError(409, 'ROLETA_BAD_STATUS', 'Esta mudança não é possível para este prêmio.'),
};

// ── switch (streamer) ──

export async function roletaOpen(): Promise<boolean> {
  const row = await db().appSetting.findUnique({ where: { key: OPEN_KEY } });
  return row ? row.value !== false : true;
}

export async function setRoletaOpen(ctx: Ctx, open: boolean): Promise<{ open: boolean }> {
  await db().$transaction(async (t) => {
    await t.appSetting.upsert({
      where: { key: OPEN_KEY },
      create: { key: OPEN_KEY, value: open },
      update: { value: open },
    });
    await audit(
      {
        action: 'settings.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'AppSetting',
        targetId: OPEN_KEY,
        metadata: { key: OPEN_KEY, value: open },
      },
      t,
    );
  });
  return { open };
}

// ── the viewer's side ──

export type MyPrize = {
  id: string;
  prize: RoletaPrize;
  status: RoletaPrizeStatus;
  createdAt: string;
  twitchLogin: string | null;
  coupon: { code: string; endsAt: string | null; used: boolean } | null;
};

export type RoletaView = {
  open: boolean;
  spinsLeft: number;
  nextAt: string;
  prizes: MyPrize[];
};

const prizeSelect = {
  id: true,
  prize: true,
  status: true,
  createdAt: true,
  twitchLogin: true,
  voucher: { select: { code: true, endsAt: true, redemptionCount: true, active: true } },
} satisfies Prisma.RoletaSpinSelect;

type PrizeRow = Prisma.RoletaSpinGetPayload<{ select: typeof prizeSelect }>;

function myPrize(r: PrizeRow): MyPrize {
  return {
    id: r.id,
    prize: r.prize,
    status: r.status!,
    createdAt: r.createdAt.toISOString(),
    twitchLogin: r.twitchLogin,
    coupon:
      r.voucher && r.status !== 'CANCELLED'
        ? {
            code: r.voucher.code,
            endsAt: r.voucher.endsAt?.toISOString() ?? null,
            used: r.voucher.redemptionCount > 0,
          }
        : null,
  };
}

async function spinsUsed(userId: string, period: Date): Promise<number> {
  return db().roletaSpin.count({ where: { userId, period } });
}

export async function myRoleta(userId: string | null, now = new Date()): Promise<RoletaView> {
  const period = roletaPeriod(now);
  const [open, used, prizes] = await Promise.all([
    roletaOpen(),
    userId ? spinsUsed(userId, period) : Promise.resolve(0),
    userId
      ? db().roletaSpin.findMany({
          where: { userId, prize: { not: 'NADA' } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: prizeSelect,
        })
      : Promise.resolve([]),
  ]);
  return {
    open,
    spinsLeft: Math.max(0, ROLETA_SPINS_PER_DAY - used),
    nextAt: nextRoletaReset(now).toISOString(),
    prizes: prizes.map(myPrize),
  };
}

function couponCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `ROLETA-${s}`;
}

export type SpinResult = {
  slot: number;
  prize: RoletaPrize;
  won: MyPrize | null;
  view: RoletaView;
};

type Rng = { draw: () => number; nadaPick: () => number };
const cryptoRng: Rng = {
  draw: () => randomInt(ROLETA_DRAW_SPACE),
  nadaPick: () => randomInt(5),
};

function isUnique(err: unknown): string | null {
  if ((err as { code?: string })?.code === 'P2002') {
    const target = (err as { meta?: { target?: unknown } }).meta?.target;
    return Array.isArray(target) ? target.join(',') : String(target ?? '');
  }
  return pgErrorCode(err) === PG.uniqueViolation ? '' : null;
}

/**
 * One spin: the next free number n of today's period (unique: a 6th spin can't be inserted, two
 * parallel spins can't take the same n), the draw, and — for a coupon — the voucher, all in one
 * transaction. Prizes are audited; "Nada" isn't.
 */
export async function spinRoleta(
  user: Viewer,
  requestId: string | null = null,
  now = new Date(),
  rng: Rng = cryptoRng,
): Promise<SpinResult> {
  if (!user.username) throw RoletaProblems.onboarding();
  if (user.status !== 'ACTIVE') throw RoletaProblems.suspended();
  if (!(await roletaOpen())) throw RoletaProblems.closed();
  const period = roletaPeriod(now);

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const spin = await db().$transaction(async (t) => {
        const used = await t.roletaSpin.count({ where: { userId: user.id, period } });
        if (used >= ROLETA_SPINS_PER_DAY) throw RoletaProblems.noSpins();
        const prize = prizeForDraw(rng.draw());
        const slot = slotForPrize(prize, rng.nadaPick());
        let voucherId: string | null = null;
        if (prize === 'CUPOM_30') {
          const v = await t.voucher.create({
            data: {
              code: couponCode(),
              kind: 'PERCENT',
              percentBps: ROLETA_COUPON_BPS,
              maxRedemptions: 1,
              maxPerUser: 1,
              endsAt: new Date(now.getTime() + ROLETA_COUPON_DAYS * DAY_MS),
            },
            select: { id: true },
          });
          voucherId = v.id;
        }
        const row = await t.roletaSpin.create({
          data: {
            userId: user.id,
            period,
            n: used + 1,
            prize,
            slot,
            status: prize === 'NADA' ? null : prize === 'CUPOM_30' ? 'DELIVERED' : 'PENDING',
            voucherId,
            deliveredAt: prize === 'CUPOM_30' ? now : null,
            createdAt: now,
          },
          select: { ...prizeSelect, slot: true },
        });
        if (prize !== 'NADA') {
          await audit(
            {
              action: 'roleta.win',
              actor: { id: user.id, role: user.role },
              requestId,
              targetType: 'RoletaSpin',
              targetId: row.id,
              metadata: { prize },
            },
            t,
          );
        }
        return row;
      });
      return {
        slot: spin.slot,
        prize: spin.prize,
        won: spin.prize === 'NADA' ? null : myPrize(spin),
        view: await myRoleta(user.id, now),
      };
    } catch (err) {
      const unique = isUnique(err);
      if (unique === null) throw err;
      // a voucher code collision or a parallel spin that took the same n: draw again
      if (attempt === 3) throw RoletaProblems.busy();
    }
  }
  throw RoletaProblems.busy();
}

/** The winner tells who they are on Twitch (movies and VIP), while the prize waits. */
export async function setTwitchLogin(
  user: Pick<User, 'id'>,
  spinId: string,
  raw: string,
): Promise<MyPrize> {
  const login = raw.trim().replace(/^@/, '').toLowerCase();
  if (!TWITCH_LOGIN.test(login)) {
    throw Problems.validation([
      {
        path: 'twitchLogin',
        message: 'Use seu usuário da Twitch: de 4 a 25 letras, números ou _.',
      },
    ]);
  }
  const row = await db().roletaSpin.findFirst({
    where: { id: spinId, userId: user.id, prize: { in: ['FILME', 'DOIS_FILMES', 'VIP_TWITCH'] } },
    select: { id: true },
  });
  if (!row) throw Problems.notFound();
  const res = await db().roletaSpin.updateMany({
    where: { id: spinId, userId: user.id, status: 'PENDING' },
    data: { twitchLogin: login },
  });
  if (res.count !== 1) throw RoletaProblems.notPending();
  const updated = await db().roletaSpin.findUniqueOrThrow({
    where: { id: spinId },
    select: prizeSelect,
  });
  return myPrize(updated);
}

// ── staff (Admin › Roleta) ──

export type StaffPrize = {
  id: string;
  prize: RoletaPrize;
  label: string;
  status: RoletaPrizeStatus;
  createdAt: string;
  deliveredAt: string | null;
  winner: string | null;
  twitchLogin: string | null;
  deliveredBy: string | null;
  coupon: { code: string; endsAt: string | null; used: boolean; active: boolean } | null;
};

export type StaffRoleta = {
  prizes: StaffPrize[];
  next: string | null;
  pending: number;
  today: { spins: number; prizes: number };
  open: boolean;
};

export async function listRoletaPrizes(
  q: { status?: RoletaPrizeStatus | undefined; before?: string | undefined },
  now = new Date(),
): Promise<StaffRoleta> {
  const status = q.status ?? 'PENDING';
  const period = roletaPeriod(now);
  const rows = await db().roletaSpin.findMany({
    where: {
      status,
      prize: { not: 'NADA' },
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 31,
    include: {
      user: { select: { username: true } },
      deliveredBy: { select: { username: true } },
      voucher: { select: { code: true, endsAt: true, redemptionCount: true, active: true } },
    },
  });
  const more = rows.length > 30;
  const shown = rows.slice(0, 30);
  const [pending, spins, prizes, open] = await Promise.all([
    db().roletaSpin.count({ where: { status: 'PENDING' } }),
    db().roletaSpin.count({ where: { period } }),
    db().roletaSpin.count({ where: { period, prize: { not: 'NADA' } } }),
    roletaOpen(),
  ]);
  return {
    prizes: shown.map((r) => ({
      id: r.id,
      prize: r.prize,
      label: PRIZE_LABEL[r.prize],
      status: r.status!,
      createdAt: r.createdAt.toISOString(),
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      winner: r.user.username,
      twitchLogin: r.twitchLogin,
      deliveredBy: r.deliveredBy?.username ?? null,
      coupon: r.voucher
        ? {
            code: r.voucher.code,
            endsAt: r.voucher.endsAt?.toISOString() ?? null,
            used: r.voucher.redemptionCount > 0,
            active: r.voucher.active,
          }
        : null,
    })),
    next: more ? shown.at(-1)!.createdAt.toISOString() : null,
    pending,
    today: { spins, prizes },
    open,
  };
}

export async function pendingRoletaCount(): Promise<number> {
  return db().roletaSpin.count({ where: { status: 'PENDING' } });
}

/**
 * Delivered / back to waiting / cancelled — compare-and-set on the status staff saw. Coupons are
 * delivered by the system and can only be cancelled (which switches their voucher off). Only the
 * streamer cancels; nothing comes back from CANCELLED.
 */
export async function setRoletaStatus(
  ctx: Ctx,
  id: string,
  input: { status: RoletaPrizeStatus; expectedStatus: RoletaPrizeStatus },
  now = new Date(),
): Promise<void> {
  if (input.status === input.expectedStatus) return;
  if (input.status === 'CANCELLED' && ctx.actor.role !== 'STREAMER')
    throw RoletaProblems.streamerOnly();
  if (input.expectedStatus === 'CANCELLED') throw RoletaProblems.badMove();
  await db().$transaction(async (t) => {
    const row = await t.roletaSpin.findUnique({
      where: { id },
      select: { prize: true, voucherId: true },
    });
    if (!row || row.prize === 'NADA') throw Problems.notFound();
    if (row.prize === 'CUPOM_30' && input.status !== 'CANCELLED') throw RoletaProblems.badMove();
    const res = await t.roletaSpin.updateMany({
      where: { id, status: input.expectedStatus },
      data:
        input.status === 'DELIVERED'
          ? { status: 'DELIVERED', deliveredAt: now, deliveredById: ctx.actor.id }
          : { status: input.status, deliveredAt: null, deliveredById: null },
    });
    if (res.count !== 1) throw RoletaProblems.changed();
    if (input.status === 'CANCELLED' && row.voucherId) {
      await t.voucher.update({ where: { id: row.voucherId }, data: { active: false } });
    }
    await audit(
      {
        action: 'roleta.status',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'RoletaSpin',
        targetId: id,
        metadata: { prize: row.prize, from: input.expectedStatus, to: input.status },
      },
      t,
    );
  });
}

/** Worker: "Nada" spins older than 30 days go (only today's spins matter for the limit). */
export async function purgeRoletaNada(now = new Date()): Promise<number> {
  const res = await db().roletaSpin.deleteMany({
    where: {
      prize: 'NADA',
      createdAt: { lt: new Date(now.getTime() - ROLETA_NADA_RETENTION_MS) },
    },
  });
  return res.count;
}
