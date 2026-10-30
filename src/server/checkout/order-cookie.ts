import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { COOKIE, setHostCookie } from '../auth/cookies';
import { getEnv } from '../env';
import { randomToken, seal, unseal } from '../security/crypto';
import { csrfTokenFor, isValidCsrfToken } from '../security/csrf';

/**
 * `__Host-wf_order` (03 §5.3): a sealed (AES-256-GCM) list of the orders this browser may see —
 * set at checkout and by the order-link exchange. HttpOnly, Secure, SameSite=Strict, 30 days,
 * ≤ 10 orders (newest first). Its random `id` binds the CSRF token for guest mutations
 * (cancel an unpaid order) — 03 §2.
 */
const PURPOSE = 'order-cookie';
const TTL_MS = 30 * 86_400_000;
const MAX_ORDERS = 10;

const payload = z
  .object({ id: z.string().min(16).max(64), orders: z.array(z.uuid()).max(MAX_ORDERS) })
  .strict();
export type OrderCookie = z.infer<typeof payload>;

function keys() {
  const env = getEnv();
  return { current: env.COOKIE_SEAL_KEY, previous: env.COOKIE_SEAL_KEY_PREVIOUS };
}

export function readOrderCookie(
  req: NextRequest | { cookies: { get(name: string): { value: string } | undefined } },
): OrderCookie | null {
  const raw = req.cookies.get(COOKIE.order)?.value;
  if (!raw) return null;
  const parsed = payload.safeParse(unseal(raw, keys(), PURPOSE));
  return parsed.success ? parsed.data : null;
}

export function withOrder(cookie: OrderCookie | null, orderId: string): OrderCookie {
  const orders = [orderId, ...(cookie?.orders ?? []).filter((o) => o !== orderId)].slice(
    0,
    MAX_ORDERS,
  );
  return { id: cookie?.id ?? randomToken(18), orders };
}

export function writeOrderCookie(res: NextResponse, cookie: OrderCookie): void {
  setHostCookie(res, COOKIE.order, seal(cookie, keys(), PURPOSE, TTL_MS), {
    maxAgeSec: TTL_MS / 1000,
    sameSite: 'strict',
  });
}

export function orderCsrfToken(cookie: OrderCookie): string {
  return csrfTokenFor(cookie.id, 'order');
}

export function isValidOrderCsrf(token: string | null, cookie: OrderCookie | null): boolean {
  return cookie !== null && isValidCsrfToken(token, cookie.id, 'order');
}
