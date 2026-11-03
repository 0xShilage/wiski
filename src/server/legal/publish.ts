import 'server-only';
import { LEGAL_TEXT, LEGAL_UPDATED } from '@/content/legal/privacy';
import { audit } from '../audit/audit';
import { db } from '../db';
import { safeEqual, sha256Bytes } from '../security/crypto';

/**
 * Register the site's legal text as the current version for checkout (Q13, 2026-11-02).
 *
 *   docker compose -f docker/compose.prod.yml exec worker \
 *     node --conditions=react-server dist/worker.mjs --publish-legal
 *
 * The site has one text ("Política de Privacidade e Proteção de Dados", src/content/legal) that
 * also holds the terms and the refund policy, so all three checkout acceptances (TERMS, PRIVACY,
 * REFUND) point at it: version = LEGAL_UPDATED, sha256 = the exact text. Idempotent. A new text
 * needs a new LEGAL_UPDATED: the same version with different bytes is refused (acceptances
 * already recorded name that version). Audited as `legal.publish`.
 */
const TYPES = ['TERMS', 'PRIVACY', 'REFUND'] as const;

export class LegalVersionConflict extends Error {}

export async function publishLegal(now = new Date()) {
  const version = LEGAL_UPDATED;
  const sha = sha256Bytes(LEGAL_TEXT);
  let published = 0;
  await db().$transaction(async (t) => {
    for (const type of TYPES) {
      const same = await t.legalDocument.findUnique({ where: { type_version: { type, version } } });
      if (same && !safeEqual(same.sha256, sha)) {
        throw new LegalVersionConflict(
          `${type} ${version} is registered with a different text: bump LEGAL_UPDATED`,
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
          metadata: { version, types: published },
        },
        t,
      );
    }
  });
  return { version, published };
}
