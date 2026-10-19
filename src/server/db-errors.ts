import 'server-only';

/**
 * Postgres SQLSTATE of an error thrown through Prisma 7 + @prisma/adapter-pg, if any.
 * Used to map reviewed-SQL invariants (CHECKs, exclusion constraints, triggers) to HTTP errors.
 */
export function pgErrorCode(err: unknown): string | null {
  const e = err as {
    code?: unknown;
    meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; code?: unknown } } };
    cause?: { originalCode?: unknown; code?: unknown };
  } | null;
  if (!e || typeof e !== 'object') return null;
  const cause = e.meta?.driverAdapterError?.cause ?? e.cause;
  const code = cause?.originalCode ?? cause?.code ?? e.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

export const PG = {
  uniqueViolation: '23505',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
  exclusionViolation: '23P01',
  /** catalog_item_guard(): live limit per kind reached (R1 reviewed SQL). */
  catalogLiveLimit: 'WF409',
} as const;
