import 'server-only';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';

/**
 * Who is buying (04 §5, 05 §5): the signed-in user, or — for guests — the normalised contact
 * e-mail. The key is what caps and limits count (1 pending order per buyer, per-buyer queue-jump
 * and voucher limits). E-mail addresses are stored as typed in Order.contactEmail (lower-cased);
 * the key itself carries only a hash.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buyerKeyFor(userId: string | null, contactEmail: string): string {
  if (userId) return `u:${userId}`;
  return `e:${createHash('sha256').update(normaliseEmail(contactEmail), 'utf8').digest('hex')}`;
}

/** Contact e-mail as accepted at checkout (WHATWG-ish, ASCII only, 6–254 chars). */
export const contactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(6)
  .max(254)
  .regex(
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/,
    'E-mail inválido.',
  );

/** Crockford base32 without I, L, O, U. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** "WF-7K3Q9X": a public reference, not a secret (≈ 30 bits; access needs the token or login). */
export function newPublicCode(): string {
  let s = 'WF-';
  for (let i = 0; i < 6; i++) s += CROCKFORD[randomInt(32)];
  return s;
}

export const PUBLIC_CODE = /^WF-[0-9A-HJKMNP-TV-Z]{6}$/;

/** The order-link token (256-bit, base64url); only its SHA-256 is stored. */
export function newAccessToken(): string {
  return randomBytes(32).toString('base64url');
}
