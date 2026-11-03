import 'server-only';
import { LEGAL_TEXT, LEGAL_UPDATED } from '@/content/legal/privacy';
import { REFUND_TEXT, REFUND_UPDATED } from '@/content/legal/refund';
import { audit } from '../audit/audit';
import { db } from '../db';
import { safeEqual, sha256Bytes } from '../security/crypto';

/**
 * Register the site's legal texts as the current versions for checkout (Q13, 2026-11-02).
 *
 *   docker compose -f docker/compose.prod.yml exec worker \
 *     node --conditions=react-server dist/worker.mjs --publish-legal
 *
 * Two texts (src/content/legal): the "Política de Privacidade e Proteção de Dados", which also
 * holds the terms of use (TERMS and PRIVACY point at it), and since 2026-11-03 the refund terms
 * (REFUND). Each document: version = its *_UPDATED date, sha256 = the exact text. Idempotent. A
 * changed text needs a new date: the same version with different bytes is refused (acceptances
 * already recorded name that version). Audited as `legal.publish`.
 */
const DOCS = [
  { type: 'TERMS', version: LEGAL_UPDATED, text: LEGAL_TEXT },
  { type: 'PRIVACY', version: LEGAL_UPDATED, text: LEGAL_TEXT },
  { type: 'REFUND', version: REFUND_UPDATED, text: REFUND_TEXT },
] as const;

export class LegalVersionConflict extends Error {}

export async function publishLegal(now = new Date()) {
  let published = 0;
  await db().$transaction(async (t) => {
    for (const { type, version, text } of DOCS) {
      const sha = sha256Bytes(text);
      const same = await t.legalDocument.findUnique({ where: { type_version: { type, version } } });
      if (same && !safeEqual(same.sha256, sha)) {
        throw new LegalVersionConflict(
          `${type} ${version} is registered with a different text: bump its date (LEGAL_UPDATED or REFUND_UPDATED)`,
        );
      }
      if (same?.isCurrent) continue;
      await t.legalDocument.updateMany({
        where: { type, isCurrent: true },
        data: { isCurrent: false },
      });
      if (same) {
        await t.legalDocument.update({ where: { id: same.id }, data: { isCurrent: true } });
      } else {
        await t.legalDocument.create({
          data: { type, version, sha256: sha, publishedAt: now, isCurrent: true },
        });
      }
      published++;
    }
    if (published) {
      await audit(
        {
          action: 'legal.publish',
          actor: null,
          requestId: null,
          targetType: 'LegalDocument',
          targetId: null,
          metadata: { version: LEGAL_UPDATED, refundVersion: REFUND_UPDATED, types: published },
        },
        t,
      );
    }
  });
  return { version: LEGAL_UPDATED, refundVersion: REFUND_UPDATED, published };
}
