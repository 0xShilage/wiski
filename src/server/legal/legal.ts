import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { LEGAL_TEXTS, type LegalText, type LegalType } from '@/content/legal/documents';
import { canonicalJson } from '@/lib/canonical-json';
import { db } from '../db';
import { HttpError } from '../http/problem';
import { sha256 } from '../security/crypto';

/**
 * Versioned legal texts (02: LegalDocument pins version + hash of the exact text shown). The
 * texts live in src/content/legal; this module mirrors the current versions into the database
 * (idempotent) and records acceptances per order.
 */
export const LEGAL_TYPES: readonly LegalType[] = ['TERMS', 'PRIVACY', 'REFUND'];

export function legalHash(t: LegalText): Buffer {
  return sha256(
    canonicalJson({ type: t.type, version: t.version, title: t.title, blocks: t.blocks }),
  );
}

export type CurrentLegal = Record<LegalType, { version: string; sha256: string; title: string }>;

export function currentLegal(): CurrentLegal {
  return Object.fromEntries(
    LEGAL_TYPES.map((type) => {
      const t = LEGAL_TEXTS[type];
      return [type, { version: t.version, sha256: legalHash(t).toString('hex'), title: t.title }];
    }),
  ) as CurrentLegal;
}

/** Production must not take money under provisional texts (13 §3 step 5). */
export function provisionalLegalTypes(): LegalType[] {
  return LEGAL_TYPES.filter((type) => LEGAL_TEXTS[type].provisional);
}

let ensured: Promise<Map<LegalType, string>> | null = null;

/** Mirror the current versions into LegalDocument (once per process); returns type → row id. */
export function ensureLegalDocuments(now = new Date()): Promise<Map<LegalType, string>> {
  ensured ??= (async () => {
    const ids = new Map<LegalType, string>();
    for (const type of LEGAL_TYPES) {
      const t = LEGAL_TEXTS[type];
      const hash = new Uint8Array(legalHash(t));
      const id = await db().$transaction(async (tx) => {
        const existing = await tx.legalDocument.findUnique({
          where: { type_version: { type, version: t.version } },
        });
        if (existing && !Buffer.from(existing.sha256).equals(Buffer.from(hash))) {
          // An accepted version was edited in place — refuse (bump the version instead).
          throw new Error(`legal text ${type} ${t.version} changed without a new version`);
        }
        await tx.legalDocument.updateMany({
          where: { type, isCurrent: true, NOT: { version: t.version } },
          data: { isCurrent: false },
        });
        const row =
          existing ??
          (await tx.legalDocument.create({
            data: { type, version: t.version, sha256: hash, publishedAt: now, isCurrent: true },
          }));
        if (!row.isCurrent) {
          await tx.legalDocument.update({ where: { id: row.id }, data: { isCurrent: true } });
        }
        return row.id;
      });
      ids.set(type, id);
    }
    return ids;
  })().catch((err: unknown) => {
    ensured = null;
    throw err;
  });
  return ensured;
}

export const LegalProblems = {
  versionChanged: () =>
    new HttpError(
      409,
      'LEGAL_VERSION_CHANGED',
      'Os termos foram atualizados. Recarregue a página, leia e aceite a versão nova.',
    ),
};

export type AcceptedVersions = Record<'terms' | 'privacy' | 'refund', string>;

/** Inside the order transaction: the buyer accepted exactly the current versions. */
export async function recordAcceptance(
  tx: Prisma.TransactionClient,
  accepted: AcceptedVersions,
  r: { orderId: string; userId: string | null },
): Promise<void> {
  const ids = await ensureLegalDocuments();
  const wanted: [LegalType, string][] = [
    ['TERMS', accepted.terms],
    ['PRIVACY', accepted.privacy],
    ['REFUND', accepted.refund],
  ];
  for (const [type, version] of wanted) {
    if (LEGAL_TEXTS[type].version !== version) throw LegalProblems.versionChanged();
  }
  await tx.legalAcceptance.createMany({
    data: wanted.map(([type]) => ({
      documentId: ids.get(type)!,
      orderId: r.orderId,
      userId: r.userId,
    })),
  });
}

/** Test helper. */
export function resetLegalCache(): void {
  ensured = null;
}
