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
  /**
   * Authenticator codes: 6 digits = 10⁶ guesses, so per account only a handful per 15 minutes
   * (with ±1 time step that is 3 valid codes in a million: ~0.003 % per window).
   */
  totpVerify: {
    name: 'totp-verify',
    perIp: { limit: 20, windowMs: 15 * MIN },
    perUser: { limit: 6, windowMs: 15 * MIN },
  },
  /** Setting up / removing the authenticator and new recovery codes. */
  totpManage: {
    name: 'totp-manage',
    perIp: { limit: 20, windowMs: HOUR },
    perUser: { limit: 10, windowMs: HOUR },
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

  // ── Phase 2 (05 §9) ──
  quote: {
    name: 'quote',
    perIp: { limit: 60, windowMs: MIN },
    perUser: { limit: 60, windowMs: MIN },
  },
  /** + 5/h per buyer (user id or e-mail), counted by the checkout itself */
  orderCreate: {
    name: 'order-create',
    perIp: { limit: 10, windowMs: HOUR },
    perUser: { limit: 5, windowMs: HOUR },
  },
  orderAccess: {
    name: 'order-access',
    perIp: { limit: 10, windowMs: MIN },
    perUser: { limit: 10, windowMs: MIN },
  },
  orderRead: {
    name: 'order-read',
    perIp: { limit: 30, windowMs: MIN },
    perUser: { limit: 60, windowMs: MIN },
  },
  orderWrite: {
    name: 'order-write',
    perIp: { limit: 20, windowMs: MIN },
    perUser: { limit: 20, windowMs: MIN },
  },
  events: { name: 'events', perIp: { limit: 30, windowMs: MIN } },
  /** Mercado Pago's notifications: generous; the signature check is cheap and comes first. */
  webhook: { name: 'webhook', perIp: { limit: 600, windowMs: MIN } },
  legalRead: { name: 'legal-read', perIp: { limit: 120, windowMs: MIN } },

  // ── Phase 3 (05 §9) ──
  reviewCreate: {
    name: 'review-create',
    perIp: { limit: 10, windowMs: HOUR },
    perUser: { limit: 5, windowMs: HOUR },
  },
  reviewCreateDaily: { name: 'review-create-day', perUser: { limit: 20, windowMs: 24 * HOUR } },
  reviewEdit: {
    name: 'review-edit',
    perIp: { limit: 60, windowMs: HOUR },
    perUser: { limit: 20, windowMs: HOUR },
  },
  like: {
    name: 'like',
    perIp: { limit: 300, windowMs: HOUR },
    perUser: { limit: 120, windowMs: HOUR },
  },
  report: {
    name: 'report',
    perIp: { limit: 20, windowMs: HOUR },
    perUser: { limit: 10, windowMs: HOUR },
  },
  /** Public review/profile reads. */
  reviewRead: { name: 'review-read', perIp: { limit: 120, windowMs: MIN } },

  // ── Phase 4 (05 §9) ──
  overlaySession: { name: 'overlay-session', perIp: { limit: 10, windowMs: MIN } },
  overlayStream: { name: 'overlay-stream', perIp: { limit: 60, windowMs: MIN } },
  contact: { name: 'contact', perIp: { limit: 5, windowMs: HOUR } },
  contactDaily: { name: 'contact-day', perIp: { limit: 20, windowMs: 24 * HOUR } },
  publicRead: { name: 'public-read', perIp: { limit: 120, windowMs: MIN } },
  /** Phase 6: viewer suggestions — 5 a day per account, 20 a day per IP. */
  suggestion: {
    name: 'suggestion',
    perIp: { limit: 20, windowMs: 24 * HOUR },
    perUser: { limit: 5, windowMs: 24 * HOUR },
  },
  dataExport: {
    name: 'data-export',
    perIp: { limit: 10, windowMs: HOUR },
    perUser: { limit: 5, windowMs: HOUR },
  },
  accountErase: {
    name: 'account-erase',
    perIp: { limit: 10, windowMs: HOUR },
    perUser: { limit: 3, windowMs: HOUR },
  },
} as const satisfies Record<string, RateLimitRule>;
