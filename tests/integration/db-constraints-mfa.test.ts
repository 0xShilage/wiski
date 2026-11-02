/**
 * Authenticator-app reviewed SQL (prisma/migrations/*_mfa_totp_constraints): the secret/enabled
 * pair, sizes, the 6-unused-codes cap and single-use recovery codes, hit through the app role.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { pgErrorCode, PG } from '@/server/db-errors';
import { makeUser } from '../support/db';

async function rejects(p: Promise<unknown>, sqlstate: string = PG.checkViolation) {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, 'expected the database to refuse').not.toBeNull();
  const code = pgErrorCode(err) ?? (err as { code?: string }).code;
  if (sqlstate === PG.uniqueViolation) expect(['23505', 'P2002']).toContain(code);
  else expect(code).toBe(sqlstate);
}

const hash = () => new Uint8Array(randomBytes(32));

describe('authenticator app constraints', () => {
  it('a secret exists exactly when it is enabled, and is 48 bytes', async () => {
    const u = await makeUser({ role: 'MODERATOR' });
    const where = { id: u.id };
    await rejects(db().user.update({ where, data: { totpSecretEnc: new Uint8Array(48) } }));
    await rejects(db().user.update({ where, data: { totpEnabledAt: new Date() } }));
    await rejects(
      db().user.update({
        where,
        data: { totpSecretEnc: new Uint8Array(20), totpEnabledAt: new Date() },
      }),
    );
    await rejects(db().user.update({ where, data: { mfaEpoch: -1 } }));
    await rejects(db().user.update({ where, data: { totpLastStep: -1n } }));
    await db().user.update({
      where,
      data: { totpSecretEnc: new Uint8Array(48), totpEnabledAt: new Date(), totpLastStep: 1n },
    });
  });

  it('recovery codes: 32-byte hash, unique per user, at most 6 unused', async () => {
    const u = await makeUser({ role: 'MODERATOR' });
    await rejects(
      db().mfaRecoveryCode.create({ data: { userId: u.id, codeHash: new Uint8Array(16) } }),
    );
    const h = hash();
    await db().mfaRecoveryCode.create({ data: { userId: u.id, codeHash: h } });
    await rejects(
      db().mfaRecoveryCode.create({ data: { userId: u.id, codeHash: h } }),
      PG.uniqueViolation,
    );
    await db().mfaRecoveryCode.createMany({
      data: Array.from({ length: 5 }, () => ({ userId: u.id, codeHash: hash() })),
    });
    await rejects(db().mfaRecoveryCode.create({ data: { userId: u.id, codeHash: hash() } }));
    // a used code frees a slot
    const one = await db().mfaRecoveryCode.findFirstOrThrow({ where: { userId: u.id } });
    await db().mfaRecoveryCode.update({ where: { id: one.id }, data: { usedAt: new Date() } });
    await db().mfaRecoveryCode.create({ data: { userId: u.id, codeHash: hash() } });
  });

  it('a used code stays used; a code never moves to another user', async () => {
    const u = await makeUser({ role: 'MODERATOR' });
    const other = await makeUser({ role: 'MODERATOR' });
    const c = await db().mfaRecoveryCode.create({ data: { userId: u.id, codeHash: hash() } });
    await rejects(db().mfaRecoveryCode.update({ where: { id: c.id }, data: { userId: other.id } }));
    await rejects(db().mfaRecoveryCode.update({ where: { id: c.id }, data: { codeHash: hash() } }));
    await db().mfaRecoveryCode.update({ where: { id: c.id }, data: { usedAt: new Date() } });
    await rejects(db().mfaRecoveryCode.update({ where: { id: c.id }, data: { usedAt: null } }));
    await rejects(
      db().mfaRecoveryCode.update({
        where: { id: c.id },
        data: { usedAt: new Date(c.createdAt.getTime() - 1000) },
      }),
    );
  });
});
