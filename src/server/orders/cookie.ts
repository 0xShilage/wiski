import 'server-only';
import type { NextResponse } from 'next/server';
import { COOKIE, setHostCookie } from '../auth/cookies';
import { getEnv } from '../env';
import { seal, unseal } from '../security/crypto';

/**
 * `__Host-wf_order` (03 §5.3): the guest's proof of access to their orders — a sealed
 * (AES-256-GCM, purpose-bound) list of up to 10 order ids, 30 days, HttpOnly, SameSite=Strict.
 * It is set by the checkout response and by exchanging the order link token; it never holds the
 * token itself.
 */
const PURPOSE = 'order-access';
const MAX_ORDERS = 10;
const TTL_MS = 30 * 86_400_000;

const keys = () => {
  const env = getEnv();
  return { current: env.COOKIE_SEAL_KEY, previous: env.COOKIE_SEAL_KEY_PREVIOUS };
};

/** Anything with a cookie jar: a NextRequest, or `{ cookies: await cookies() }` in a page. */
export type CookieSource = { cookies: { get(name: string): { value: string } | undefined } };

export function orderIdsFromCookie(req: CookieSource): string[] {
  const raw = req.cookies.get(COOKIE.order)?.value;
  if (!raw) return [];
  const v = unseal<{ ids?: unknown }>(raw, keys(), PURPOSE);
  return Array.isArray(v?.ids)
    ? v.ids.filter((x): x is string => typeof x === 'string').slice(0, MAX_ORDERS)
    : [];
}

/** Add an order to the cookie (most recent first, at most 10). */
export function addOrderToCookie(res: NextResponse, req: CookieSource, orderId: string): void {
  const ids = [orderId, ...orderIdsFromCookie(req).filter((x) => x !== orderId)].slice(
    0,
    MAX_ORDERS,
  );
  setHostCookie(res, COOKIE.order, seal({ ids }, keys(), PURPOSE, TTL_MS), {
    maxAgeSec: TTL_MS / 1000,
    sameSite: 'strict',
  });
}
