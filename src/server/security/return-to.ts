/**
 * `returnTo` validation for login redirects (05 §5 "open redirect"). Only same-site relative
 * paths are allowed; the value travels inside the sealed OAuth cookie, never in the callback URL.
 */
export const DEFAULT_RETURN_TO = '/perfil';
const BASE = 'https://returnto.invalid';

export function safeReturnTo(
  input: string | null | undefined,
  fallback = DEFAULT_RETURN_TO,
): string {
  if (!input || input.length > 512) return fallback;
  // Relative path only: one leading slash, no scheme-relative (//), no backslashes (/\ is
  // treated as // by browsers), no control characters or whitespace.
  // eslint-disable-next-line no-control-regex -- intentionally matching control characters
  if (!input.startsWith('/') || input.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(input)) {
    return fallback;
  }
  // Encoded slashes/backslashes could become // after a later decode by some intermediary.
  if (/%(?:2f|5c)/i.test(input)) return fallback;
  let url: URL;
  try {
    url = new URL(input, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  // API and auth endpoints are never a landing page (avoids redirect loops / logout CSRF).
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return fallback;
  return `${url.pathname}${url.search}`;
}
