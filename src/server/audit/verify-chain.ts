import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * End-to-end verification of the audit hash chain (02 §4). Each row must
 *  (1) link to the previous row's hash (prevHash), and
 *  (2) carry the hash the reviewed SQL function audit_log_expected_hash() recomputes from its
 *      stored fields — the same function the insert trigger uses.
 * Detects altered, deleted-in-the-middle, inserted or reordered rows. Truncation of the newest
 * rows is detected against the last recorded anchor (head id + hash), which the nightly job logs.
 *
 * Raw SQL: one parameterised tagged-template SELECT calling the reviewed function (documented
 * exception to "Prisma only", 01 §5).
 */
export type ChainVerification =
  | { ok: true; checked: number; head: { id: bigint; hash: string } | null }
  | { ok: false; checked: number; badId: bigint; reason: 'link' | 'hash' };

type Row = {
  id: bigint;
  prevHash: Uint8Array | null;
  hash: Uint8Array | null;
  expected: Uint8Array | null;
};

const GENESIS = Buffer.from([0]);

function same(a: Uint8Array | null, b: Uint8Array | null): boolean {
  return !!a && !!b && Buffer.from(a).equals(Buffer.from(b));
}

export async function verifyAuditChain(
  prisma: PrismaClient,
  batchSize = 1000,
): Promise<ChainVerification> {
  let prev: Uint8Array = GENESIS;
  let after = 0n;
  let checked = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT a.id, a."prevHash", a.hash, audit_log_expected_hash(a) AS expected
      FROM "AuditLog" a
      WHERE a.id > ${after}
      ORDER BY a.id
      LIMIT ${batchSize}`;
    for (const row of rows) {
      if (!same(row.prevHash, prev)) return { ok: false, checked, badId: row.id, reason: 'link' };
      if (!same(row.hash, row.expected))
        return { ok: false, checked, badId: row.id, reason: 'hash' };
      prev = row.hash!;
      after = row.id;
      checked++;
    }
    if (rows.length < batchSize) break;
  }
  return {
    ok: true,
    checked,
    head: checked > 0 ? { id: after, hash: Buffer.from(prev).toString('hex') } : null,
  };
}
