import 'server-only';
import { z } from 'zod';
import { canonicalJson } from '@/lib/canonical-json';
import { HttpError } from '../http/problem';
import { sha256 } from '../security/crypto';
import { legalVersionsSchema } from './checkout';
import { contactEmailSchema } from './identity';
import { OrderProblems } from './problems';

/** Request schemas for the checkout endpoints (.strict(): unknown keys → 422, 04 §11 tamper). */
const tierId = z.string().regex(/^[a-z][a-z0-9-]{1,23}$/);
const voucherCode = z.string().trim().min(1).max(40);

const buyerFields = {
  contactEmail: contactEmailSchema.optional(),
  displayName: z.string().max(60).optional(),
  message: z.string().max(400).optional(),
  showSponsorName: z.boolean().default(true),
  legal: legalVersionsSchema,
};

export const quoteInput = z
  .object({
    itemId: z.uuid(),
    queueJumpTierId: tierId.nullable().default(null),
    voucherCode: voucherCode.nullable().default(null),
  })
  .strict();

export const movieCheckoutInput = z
  .object({
    itemId: z.uuid(),
    queueJumpTierId: tierId.nullable().default(null),
    voucherCode: voucherCode.nullable().default(null),
    /** the total the buyer saw — a different server price answers 409, never charges (04 §1) */
    expectedTotalCents: z.int().min(1).max(100_000_000),
    ...buyerFields,
  })
  .strict();

export const contributionInput = z
  .object({
    amountCents: z.int().min(1).max(100_000_000),
    ...buyerFields,
  })
  .strict();

export const accessInput = z.object({ token: z.string().regex(/^[\w-]{43}$/) }).strict();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `Idempotency-Key: <uuid>` is required on checkout (03 §1). */
export function idempotencyKeyFrom(headers: Headers): string {
  const key = headers.get('idempotency-key');
  if (!key) throw OrderProblems.idempotencyKeyRequired();
  if (!UUID.test(key)) {
    throw new HttpError(422, 'VALIDATION_FAILED', 'Alguns campos estão inválidos.', {
      errors: [{ path: '(header) Idempotency-Key', message: 'Deve ser um UUID.' }],
    });
  }
  return key.toLowerCase();
}

/** Same key + different body = conflict; the hash covers the parsed, canonical body. */
export function requestHash(body: unknown): string {
  return sha256(canonicalJson(body)).toString('hex');
}
