/**
 * Production legal registration (2026-11-02): `worker --publish-legal` makes the privacy text the
 * current TERMS and PRIVACY version and (2026-11-03) the refund terms the REFUND version, so
 * checkout opens; idempotent; the same version with a different text is refused.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LEGAL_TEXT, LEGAL_UPDATED } from '@/content/legal/privacy';
import { REFUND_TEXT, REFUND_UPDATED } from '@/content/legal/refund';
import { currentLegal } from '@/server/checkout/status';
import { db } from '@/server/db';
import { LegalVersionConflict, publishLegal } from '@/server/legal/publish';
import { sha256Bytes } from '@/server/security/crypto';

beforeEach(async () => {
  await db().legalAcceptance.deleteMany({});
  await db().legalDocument.deleteMany({});
});

describe('publishLegal', () => {
  it('registers the three types with the text hash; checkout sees them; a re-run is a no-op', async () => {
    expect(await currentLegal()).toBeNull();
    const result = { version: LEGAL_UPDATED, refundVersion: REFUND_UPDATED };
    expect(await publishLegal()).toEqual({ ...result, published: 3 });
    const legal = await currentLegal();
    expect(legal).toMatchObject({
      TERMS: { version: LEGAL_UPDATED },
      PRIVACY: { version: LEGAL_UPDATED },
      REFUND: { version: REFUND_UPDATED },
    });
    const docs = await db().legalDocument.findMany({ where: { isCurrent: true } });
    for (const d of docs)
      expect(Buffer.from(d.sha256)).toEqual(
        Buffer.from(sha256Bytes(d.type === 'REFUND' ? REFUND_TEXT : LEGAL_TEXT)),
      );
    expect(await publishLegal()).toEqual({ ...result, published: 0 });
    expect(await db().legalDocument.count()).toBe(3);
    expect(
      await db().auditLog.count({ where: { action: 'legal.publish' } }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('replaces an older current version (e.g. the dev placeholder)', async () => {
    for (const type of ['TERMS', 'PRIVACY', 'REFUND'] as const) {
      await db().legalDocument.create({
        data: {
          type,
          version: 'provisorio-dev',
          sha256: sha256Bytes('x'),
          publishedAt: new Date(),
          isCurrent: true,
        },
      });
    }
    await publishLegal();
    expect(
      await db().legalDocument.count({
        where: { isCurrent: true, version: { in: [LEGAL_UPDATED, REFUND_UPDATED] } },
      }),
    ).toBe(3);
    expect(await db().legalDocument.count({ where: { isCurrent: false } })).toBe(3);
  });

  it('refuses the same version with a different text', async () => {
    await db().legalDocument.create({
      data: {
        type: 'PRIVACY',
        version: LEGAL_UPDATED,
        sha256: sha256Bytes('another text'),
        publishedAt: new Date(),
        isCurrent: false,
      },
    });
    await expect(publishLegal()).rejects.toBeInstanceOf(LegalVersionConflict);
    expect(await db().legalDocument.count({ where: { isCurrent: true } })).toBe(0); // rolled back
  });
});
