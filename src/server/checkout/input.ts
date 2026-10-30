import 'server-only';
import { z } from 'zod';
import { codePointLength, plainText } from '../text/sanitize';
import { contactEmailSchema } from './buyer';

/**
 * Checkout request bodies (03 §5.3, 11 §8). `.strict()`: the client sends selections only —
 * never a price, discount or perk (04 §1.1, 05 §5 tamper tests). `expectedTotalCents` exists only
 * so the server can answer 409 PRICE_CHANGED instead of charging a different amount.
 */
const tierId = z.string().regex(/^[a-z][a-z0-9-]{1,23}$/);
const voucherCode = z
  .string()
  .trim()
  .toUpperCase()
  .max(40)
  .transform((s) => s.replace(/\s+/g, ''));
const version = z.string().min(1).max(40);

/** Sanitised one-line text with a code-point limit (05 §8). */
const text = (min: number, max: number, message: string) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => plainText(s))
    .refine((s) => codePointLength(s) >= min && codePointLength(s) <= max, { message });

export const legalAcceptance = z
  .object({ terms: version, privacy: version, refund: version })
  .strict();

export const quoteInput = z
  .object({
    movieId: z.uuid(),
    queueJumpTier: tierId.nullable().default(null),
    voucherCode: voucherCode.nullable().optional(),
  })
  .strict();

const buyerFields = {
  /** guests: required; signed-in users: optional (default: their Google e-mail) */
  contactEmail: contactEmailSchema.optional(),
  /** guests only; shown publicly only after moderator approval (05 §5) */
  displayName: text(2, 24, 'Use de 2 a 24 caracteres.').optional(),
  /** "patrocinar anonimamente" (Q16) */
  anonymous: z.boolean().default(false),
  /** shown on stream only after moderator approval (Q10) */
  message: text(1, 140, 'Use até 140 caracteres.').optional(),
  legal: legalAcceptance,
};

export const movieOrderInput = z
  .object({
    movieId: z.uuid(),
    queueJumpTier: tierId.nullable().default(null),
    voucherCode: voucherCode.nullable().optional(),
    expectedTotalCents: z.int().positive().max(100_000_000),
    ...buyerFields,
  })
  .strict();

export const contributionInput = z
  .object({
    amountCents: z.int().positive().max(100_000_000),
    ...buyerFields,
  })
  .strict();

export const accessInput = z.object({ token: z.string().regex(/^[\w-]{43}$/) }).strict();

export type QuoteInput = z.infer<typeof quoteInput>;
export type MovieOrderInput = z.infer<typeof movieOrderInput>;
export type ContributionInput = z.infer<typeof contributionInput>;

export const idempotencyKeySchema = z.uuid();
