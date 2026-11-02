/**
 * Nightly audit hash-chain verification (02 §4), run by the worker daily at 03:30
 * America/Sao_Paulo (src/worker/main.ts). A break is logged with alert=security (e-mail to the
 * streamer once a provider exists, Phase 2 open item E1). The head anchor (id + hash) is logged
 * every run so tail truncation is detectable.
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
