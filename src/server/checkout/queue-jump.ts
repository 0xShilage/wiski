import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { PricingConfig } from '../pricing/config';
import type { QueueJumpAvailability } from '../pricing/engine';

type Tx = Prisma.TransactionClient | Prisma.DefaultPrismaClient;

/**
 * Queue-jump slots (04 §5). Caps count per America/Sao_Paulo calendar day (by purchase time) and
 * ISO week (Mon–Sun, BRT). Allocation runs under one transaction-scoped advisory lock, so the
 * counts and the inserted indexes can't race; the (day, dayIndex) / (isoWeek, weekIndex) unique
 * constraints stay as the database backstop.
 */
const BRT_OFFSET_MS = 3 * 3_600_000; // America/Sao_Paulo: fixed −03:00 (no DST since 2019)

export function brtDay(now: Date): Date {
  const local = new Date(now.getTime() - BRT_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** ISO-8601 week of the BRT calendar day: "2026-W44" (week 53 when the year has one). */
export function isoWeek(now: Date): string {
  const d = brtDay(now);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const thursday = new Date(d.getTime() + (3 - dow) * 86_400_000);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = 1 + Math.floor((thursday.getTime() - jan1) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

async function counts(t: Tx, cfg: PricingConfig, tierId: string, buyerKey: string, now: Date) {
  const day = brtDay(now);
  const week = isoWeek(now);
  const [dayRows, weekRows, buyerToday] = await Promise.all([
    t.queueJumpSlot.findMany({ where: { day }, select: { dayIndex: true, tierId: true } }),
    t.queueJumpSlot.findMany({ where: { isoWeek: week }, select: { weekIndex: true } }),
    t.queueJumpSlot.count({ where: { day, order: { buyerKey } } }),
  ]);
  const tier = cfg.queueJump.tiers.find((x) => x.id === tierId);
  const tierToday = dayRows.filter((r) => r.tierId === tierId).length;
  const availability: QueueJumpAvailability = {
    soldOut:
      dayRows.length >= cfg.queueJump.dailyCap ||
      weekRows.length >= cfg.queueJump.weeklyCap ||
      (tier?.dailyCap !== undefined && tierToday >= tier.dailyCap),
    buyerLimitReached: buyerToday >= cfg.queueJump.perBuyerDailyCap,
  };
  return { day, week, dayRows, weekRows, availability };
}

/** Read-only availability for the quote (no lock; the reservation re-checks under the lock). */
export async function queueJumpAvailability(
  t: Tx,
  cfg: PricingConfig,
  tierId: string,
  buyerKey: string,
  now: Date,
): Promise<QueueJumpAvailability> {
  return (await counts(t, cfg, tierId, buyerKey, now)).availability;
}

function lowestFree(used: number[], cap: number): number | null {
  const taken = new Set(used);
  for (let i = 0; i < cap; i++) if (!taken.has(i)) return i;
  return null;
}

/**
 * Inside the checkout transaction: lock, re-count, and (when a tier was chosen) insert the slot.
 * Returns the availability the engine needs; when it says sold out / buyer limit, nothing is
 * inserted and the caller lets the engine raise the matching error.
 */
export async function lockQueueJump(
  t: Prisma.TransactionClient,
  cfg: PricingConfig,
  tierId: string,
  buyerKey: string,
  now: Date,
): Promise<{ availability: QueueJumpAvailability; allocate: (orderId: string) => Promise<void> }> {
  // Documented tagged-template exception (docs/phase-2/README.md §4): a transaction-scoped lock.
  await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('wiskiflix.queue_jump'))`;
  const c = await counts(t, cfg, tierId, buyerKey, now);
  const tier = cfg.queueJump.tiers.find((x) => x.id === tierId);
  return {
    availability: c.availability,
    allocate: async (orderId: string) => {
      const dayIndex = lowestFree(
        c.dayRows.map((r) => r.dayIndex),
        cfg.queueJump.dailyCap,
      );
      const weekIndex = lowestFree(
        c.weekRows.map((r) => r.weekIndex),
        cfg.queueJump.weeklyCap,
      );
      if (!tier || dayIndex === null || weekIndex === null) throw new Error('queue-jump: no slot');
      await t.queueJumpSlot.create({
        data: {
          orderId,
          day: c.day,
          tierId,
          dayIndex,
          isoWeek: c.week,
          weekIndex,
          multiplierBps: tier.bps,
          expiresAt: new Date(now.getTime() + cfg.queueJump.reservationTtlMinutes * 60_000),
        },
      });
    },
  };
}
