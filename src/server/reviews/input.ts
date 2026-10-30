import 'server-only';
import { z } from 'zod';
import { REPORT_REASONS } from '@/lib/reviews/types';

/**
 * Request schemas (03 §5.4). Raw text limits are generous on purpose: the sanitiser runs first and
 * the sanitised length (code points, as Postgres counts them) is what's enforced — 422 otherwise.
 */
const rawBody = z.string().max(8000);

export const createReviewInput = z
  .object({
    rating: z.int().min(1).max(5),
    body: rawBody,
    containsSpoilers: z.boolean(),
  })
  .strict();

export const editReviewInput = z
  .object({
    rating: z.int().min(1).max(5).optional(),
    body: rawBody.optional(),
    containsSpoilers: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => v.rating !== undefined || v.body !== undefined || v.containsSpoilers !== undefined,
    {
      message: 'Nada para alterar.',
    },
  );

export const reportInput = z
  .object({
    reason: z.enum(REPORT_REASONS),
    note: z.string().max(2000).optional(),
  })
  .strict();

const cursor = z
  .string()
  .max(200)
  .regex(/^[\w-]+$/);

export const listQuery = z
  .object({ sort: z.enum(['recent', 'top']).default('recent'), cursor: cursor.optional() })
  .strict();

export const cursorQuery = z.object({ cursor: cursor.optional() }).strict();

export const moderationInput = z
  .object({
    action: z.enum(['HIDE', 'RESTORE', 'DISMISS', 'REMOVE']),
    /** the status the moderator saw — another moderator acting first answers 409 */
    expectedStatus: z.enum(['VISIBLE', 'AUTO_HIDDEN', 'HIDDEN']),
  })
  .strict();

export const queueQuery = z.object({ cursor: cursor.optional() }).strict();

export const UUID_PARAM = z.uuid();
