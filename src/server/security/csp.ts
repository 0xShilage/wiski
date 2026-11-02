/**
 * Content-Security-Policy (05 §7). Exactly one owner: the app (nonces are per request).
 * Imported by src/proxy.ts — keep this module free of server-only/DB imports.
 */

/** 128-bit nonce, base64. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export type CspOptions = { nonce: string; origin: string; dev: boolean };

/**
 * Page policy. Production is exactly the 05 §7 policy. Development adds what Next.js documents
 * for its dev tooling ('unsafe-eval' for React's error overlays, inline dev styles).
 * `upgrade-insecure-requests` is emitted only for an https origin (local http e2e runs).
 */
export function pageCsp({ nonce, origin, dev }: CspOptions): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    dev ? `style-src 'self' 'unsafe-inline'` : `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    // Turnstile, the trailer player (created only after "Assistir trailer", 11 §6) and the
    // home page's Twitch player (created only after "Assistir aqui", 2026-11-02).
    `frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.twitch.tv`,
    `manifest-src 'self'`,
    `media-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(origin.startsWith('https://') ? ['upgrade-insecure-requests'] : []),
    `report-to csp`,
    `report-uri /api/csp-report`,
  ];
  return directives.join('; ');
}

/** Trusted Types trial (report-only); promoted to the enforcing policy once reports stay clean. */
export const TRUSTED_TYPES_REPORT_ONLY = `require-trusted-types-for 'script'; report-to csp; report-uri /api/csp-report`;

/** JSON/API responses render nothing: deny everything. */
export const API_CSP = `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;

export function reportingEndpoints(origin: string): string {
  return `csp="${origin}/api/csp-report"`;
}
