import 'server-only';
import type { Role } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { buyerKeyFor } from '../checkout/buyer';
import { db } from '../db';
import { HttpError, Problems } from '../http/problem';
import { logger } from '../log';
import { redis } from '../redis';

/**
 * "Liberar pedidos" (2026-11-04): the streamer clears the checkout counters of one account when a
 * viewer is locked out by the hourly caps — five checkouts an hour per account and buyer, ten per
 * IP (05 §9) — or by the coupon cool-down after mistyping a code.
 *
 * It only deletes counters, never a rule: every limit starts counting again from zero right away.
 * What it deliberately does NOT touch is the two database caps, because clearing those would mean
 * cancelling an order or taking a movie's hold away: one unpaid order per buyer and two per IP.
 * Those are reported back instead, so the dashboard can say what is still in the way.
 *
 * Keys are built by name (never SCAN or a pattern delete): the counters of this account, of its
 * buyer keys, and of the IP buckets of its recent orders — which is also what the viewer's
 * household shares, and the reason this is a streamer action and is audited.
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

/** How many of the account's most recent orders are read for buyer keys and IP buckets. */
const RECENT_ORDERS = 20;
/** At most this many IP buckets are cleared (one reset must not free a whole network). */
export const MAX_IPS = 5;

export type UnthrottleResult = {
  /** counters deleted (a key that was already empty doesn't count) */
  cleared: number;
  /** IP buckets cleared */
  ips: number;
  /** unpaid orders still held by this buyer (1 is already the cap) */
  pendingOrders: number;
  /** unpaid orders on the IP buckets that were cleared (2 per IP is the cap) */
  pendingOnIps: number;
};

export const UnthrottleProblems = {
  unavailable: () =>
    new HttpError(
      503,
      'RATE_LIMIT_STORE_UNAVAILABLE',
      'Não foi possível falar com o contador de limites agora. Tente de novo em instantes.',
    ),
};

/** Per-user, per-buyer and per-IP counters that stand between a viewer and a new order. */
function keysFor(userId: string, buyerKeys: string[], ipKeys: string[]): string[] {
  const perUser = ['order-create', 'quote', 'order-write', 'order-access'];
  const perIp = ['order-create', 'quote', 'order-write', 'order-access'];
  return [
    ...perUser.map((r) => `rl:${r}:u:${userId}`),
    ...perIp.flatMap((r) => ipKeys.map((ip) => `rl:${r}:ip:${ip}`)),
    // the checkout's own per-buyer counter (orders.ts: BUYER_CREATES_PER_HOUR)
    ...buyerKeys.map((b) => `rl:order-create:b:${b}`),
    // the invalid-coupon counter and the cool-down it starts (orders.ts: voucherFailed)
    ...[
      `u:${userId}`,
      ...buyerKeys.map((b) => `b:${b}`),
      ...ipKeys.map((ip) => `ip:${ip}`),
    ].flatMap((k) => [`rl:voucher-invalid:${k}`, `vcool:${k}`]),
  ];
}

export async function clearOrderLimits(ctx: Ctx, userId: string): Promise<UnthrottleResult> {
  const user = await db().user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, email: true },
  });
  if (!user || user.status === 'DELETED') throw Problems.notFound();

  const recent = await db().order.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: RECENT_ORDERS,
    select: { buyerKey: true, ipKey: true, status: true },
  });
  const buyerKeys = [
    ...new Set([
      buyerKeyFor(user.id, user.email),
      buyerKeyFor(null, user.email),
      ...recent.map((o) => o.buyerKey),
    ]),
  ];
  const ipKeys = [...new Set(recent.map((o) => o.ipKey).filter((ip): ip is string => !!ip))].slice(
    0,
    MAX_IPS,
  );

  let cleared = 0;
  try {
    const keys = keysFor(user.id, buyerKeys, ipKeys);
    // one call, explicit keys: nothing else in Redis can be caught by this
    cleared = keys.length ? await redis().del(...keys) : 0;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : 'unknown', userId: user.id },
      'order limit reset failed',
    );
    throw UnthrottleProblems.unavailable();
  }

  const pendingOnIps = ipKeys.length
    ? await db().order.count({ where: { ipKey: { in: ipKeys }, status: 'PENDING_PAYMENT' } })
    : 0;
  const result: UnthrottleResult = {
    cleared,
    ips: ipKeys.length,
    pendingOrders: recent.filter((o) => o.status === 'PENDING_PAYMENT').length,
    pendingOnIps,
  };
  await audit({
    action: 'user.unthrottle',
    actor: ctx.actor,
    requestId: ctx.requestId,
    targetType: 'User',
    targetId: user.id,
    metadata: { cleared: result.cleared, ips: result.ips },
  });
  return result;
}
