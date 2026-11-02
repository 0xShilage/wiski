import 'server-only';
import type { NextResponse } from 'next/server';

/**
 * Cookie inventory (05 §7). All `__Host-`: Secure, Path=/, no Domain → host-only, can't be set
 * by a sibling subdomain. No third-party or analytics cookies.
 */
export const COOKIE = {
  /** server-side session token (hash stored in DB) */
  session: '__Host-wf_session',
  /** sealed OIDC state/nonce/PKCE verifier/returnTo, 10 min, one-time */
  oauth: '__Host-wf_oauth',
  /** Phase 2: sealed list of guest orders */
  order: '__Host-wf_order',
  /** Phase 4: overlay read-only session */
  overlay: '__Host-wf_overlay',
  /** sealed "this browser passed the admin second factor" (user, time, epoch), ≤ 96 h */
  mfa: '__Host-wf_mfa',
} as const;

type SameSite = 'lax' | 'strict';

export function setHostCookie(
  res: NextResponse,
  name: (typeof COOKIE)[keyof typeof COOKIE],
  value: string,
  { maxAgeSec, sameSite }: { maxAgeSec: number; sameSite: SameSite },
): void {
  res.cookies.set({
    name,
    value,
    httpOnly: true,
    secure: true,
    sameSite,
    path: '/',
    maxAge: maxAgeSec,
  });
}

export function clearHostCookie(
  res: NextResponse,
  name: (typeof COOKIE)[keyof typeof COOKIE],
  sameSite: SameSite = 'lax',
): void {
  res.cookies.set({
    name,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite,
    path: '/',
    maxAge: 0,
  });
}

/** Session cookies are always Lax (top-level navigations from Google must carry them). */
export function setSessionCookie(res: NextResponse, token: string, maxAgeSec: number): void {
  setHostCookie(res, COOKIE.session, token, { maxAgeSec, sameSite: 'lax' });
}
