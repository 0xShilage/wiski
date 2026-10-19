/**
 * Rate-limit rules (05 §9). A rule limits per IP bucket and/or per user; every rule applied to a
 * request must allow it.
 */
export type RateLimitRule = {
  /** stable name, part of the Redis key */
  name: string;
  perIp?: { limit: number; windowMs: number };
  perUser?: { limit: number; windowMs: number };
};

const MIN = 60_000;
const HOUR = 60 * MIN;

export const RL = {
  auth: { name: 'auth', perIp: { limit: 20, windowMs: MIN } },
  usernameAvailability: {
    name: 'username-availability',
    perIp: { limit: 30, windowMs: MIN },
    perUser: { limit: 30, windowMs: MIN },
  },
  account: {
    name: 'account',
    perIp: { limit: 60, windowMs: MIN },
    perUser: { limit: 60, windowMs: MIN },
  },
  profileWrite: {
    name: 'profile-write',
    perIp: { limit: 20, windowMs: HOUR },
    perUser: { limit: 10, windowMs: HOUR },
  },
  cspReport: { name: 'csp-report', perIp: { limit: 60, windowMs: MIN } },
  admin: {
    name: 'admin',
    perIp: { limit: 300, windowMs: MIN },
    perUser: { limit: 300, windowMs: MIN },
  },
  /** WebAuthn ceremonies (R1): generous for humans, useless for guessing. */
  passkey: {
    name: 'passkey',
    perIp: { limit: 30, windowMs: MIN },
    perUser: { limit: 20, windowMs: MIN },
  },
  /** Admin writes (catalog, campaigns). */
  adminWrite: {
    name: 'admin-write',
    perIp: { limit: 120, windowMs: MIN },
    perUser: { limit: 120, windowMs: MIN },
  },
  /** Image uploads (11 §9): nginx allows 2/min per IP with a burst; the app adds a per-user cap. */
  mediaUpload: {
    name: 'media-upload',
    perIp: { limit: 20, windowMs: 10 * MIN },
    perUser: { limit: 20, windowMs: 10 * MIN },
  },
  /** Public catalog reads (cached; generous). */
  catalogRead: { name: 'catalog-read', perIp: { limit: 240, windowMs: MIN } },

  // ── Phase 2 (payments) ──
  /** Live price preview (side-effect free). */
  quote: {
    name: 'quote',
    perIp: { limit: 60, windowMs: MIN },
    perUser: { limit: 60, windowMs: MIN },
  },
  /** Creating a Pix (Turnstile + 1 pending per buyer + 2 per IP on top). */
  checkout: {
    name: 'checkout',
    perIp: { limit: 10, windowMs: 10 * MIN },
    perUser: { limit: 10, windowMs: 10 * MIN },
  },
  /** Order page reads and its polling fallback (every 4 s). */
  orderRead: {
    name: 'order-read',
    perIp: { limit: 120, windowMs: MIN },
    perUser: { limit: 120, windowMs: MIN },
  },
  /** Exchanging an order-link token: tight (a guessing target, though 256-bit). */
  orderAccess: { name: 'order-access', perIp: { limit: 20, windowMs: 10 * MIN } },
  /** Cancel / claim. */
  orderWrite: {
    name: 'order-write',
    perIp: { limit: 20, windowMs: 10 * MIN },
    perUser: { limit: 20, windowMs: 10 * MIN },
  },
  /** Live updates (SSE): opening streams. */
  events: { name: 'events', perIp: { limit: 60, windowMs: MIN } },
  /** Mercado Pago notifications: MP retries; this only blunts floods (nginx limits too). */
  webhook: { name: 'webhook', perIp: { limit: 600, windowMs: MIN } },
} as const satisfies Record<string, RateLimitRule>;
