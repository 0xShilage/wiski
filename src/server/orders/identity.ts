import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { randomToken, sha256 } from '../security/crypto';

/**
 * Order identity: public codes, access tokens, buyer keys and contact e-mails.
 *
 *  • publicCode "WF-7K3Q9X": a reference people can read out (Crockford base32), not a secret.
 *  • access token: 256-bit random, returned once (order link `#t=…`), only its SHA-256 is stored.
 *  • buyerKey: "u:<userId>" for signed-in buyers, "e:<hex sha256(normalised e-mail)>" for guests —
 *    the per-buyer limits never need the e-mail in clear.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PUBLIC_CODE_PATTERN = /^WF-[0-9A-HJKMNP-TV-Z]{6}$/;

export function newPublicCode(): string {
  // 6 × 5 bits from 30 random bits (no modulo bias: 32 divides 256).
  const bytes = randomBytes(6);
  return `WF-${[...bytes].map((b) => CROCKFORD[b % 32]).join('')}`;
}

export function newAccessToken(): { token: string; hash: Uint8Array<ArrayBuffer> } {
  const token = randomToken(32);
  return { token, hash: new Uint8Array(sha256(token)) };
}

/** Normalised contact e-mail: trimmed, NFC, lower-case (the DB CHECK requires lower-case). */
export function normaliseEmail(email: string): string {
  return email.normalize('NFC').trim().toLowerCase();
}

/** What guests may type as a contact e-mail (deliberately strict: ASCII, one @, a dot domain). */
export const contactEmailSchema = z
  .string()
  .trim()
  .max(254)
  .transform(normaliseEmail)
  .pipe(
    z
      .string()
      .min(6)
      .regex(
        /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/,
        'E-mail inválido.',
      ),
  );

export function buyerKeyForUser(userId: string): string {
  return `u:${userId}`;
}

export function buyerKeyForEmail(email: string): string {
  return `e:${sha256(normaliseEmail(email)).toString('hex')}`;
}
