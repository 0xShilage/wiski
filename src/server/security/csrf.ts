import 'server-only';
import { getEnv } from '../env';
import { hmacSha256, safeEqual } from './crypto';

/**
 * CSRF defence for mutations (03 §2):
 *  1. Sec-Fetch-Site must be `same-origin` when present;
 *  2. Origin must equal the canonical origin exactly (no suffix/prefix logic);
 *  3. for session-bound requests, `x-csrf-token` == HMAC(sessionId, CSRF_SECRET)
 *     (rendered into <meta name="csrf-token">, attached by apiFetch()).
 * Plus SameSite=Lax on the session cookie.
 */
export const CSRF_HEADER = 'x-csrf-token';

export function isSameOriginRequest(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  const origin = headers.get('origin');
  // Browsers always send Origin on POST/PUT/PATCH/DELETE fetches; a missing Origin on a
  // mutation is treated as cross-site.
  return origin !== null && origin === getEnv().APP_ORIGIN;
}

export function csrfTokenFor(bindingId: string, scope: 'session' | 'order' = 'session'): string {
  return hmacSha256(getEnv().CSRF_SECRET, `csrf:v1:${scope}:${bindingId}`).toString('base64url');
}

export function isValidCsrfToken(
  token: string | null,
  bindingId: string,
  scope: 'session' | 'order' = 'session',
): boolean {
  if (!token || token.length > 64) return false;
  return safeEqual(token, csrfTokenFor(bindingId, scope));
}
