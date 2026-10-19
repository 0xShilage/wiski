/**
 * Nightly audit hash-chain verification — job stub (02 §4). Phase 2 adds the BullMQ worker that
 * schedules it (`audit.verify`, daily 03:30 America/Sao_Paulo) and e-mails the streamer on a
 * break. The head anchor (id + hash) is logged every run so tail truncation is detectable.
 */
import { db } from '@/server/db';
import { logger } from '@/server/log';
import { verifyAuditChain } from '@/server/audit/verify-chain';

export async function runAuditVerify(): Promise<boolean> {
  const result = await verifyAuditChain(db());
  if (result.ok) {
    logger.info(
      {
        job: 'audit.verify',
        checked: result.checked,
        headId: result.head?.id.toString(),
        headHash: result.head?.hash,
      },
      'audit chain verified',
    );
    return true;
  }
  logger.error(
    {
      job: 'audit.verify',
      badId: result.badId.toString(),
      reason: result.reason,
      alert: 'security',
    },
    'AUDIT CHAIN BROKEN',
  );
  return false;
}
