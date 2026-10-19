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
} as const satisfies Record<string, RateLimitRule>;
