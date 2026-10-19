/** Audit log service + hash-chain verifier: tamper test detects an altered row (10 §2 step 11). */
import { describe, expect, it } from 'vitest';
import { audit } from '@/server/audit/audit';
import { verifyAuditChain } from '@/server/audit/verify-chain';
import { db } from '@/server/db';
import { runAuditVerify } from '@/worker/jobs/audit-verify';
import { makeUser, resetAuditLog, withAdmin } from '../support/db';

describe('audit service', () => {
  it('writes allow-listed metadata with actor, request id and a chained hash', async () => {
    const user = await makeUser({ role: 'STREAMER' });
    await audit({
      action: 'auth.login',
      actor: { id: user.id, role: user.role },
      targetType: 'User',
      targetId: user.id,
      metadata: { method: 'google', stepUp: true },
      requestId: 'req-1234567890abcdef',
    });
    const row = await db().auditLog.findFirstOrThrow({
      where: { targetId: user.id },
      orderBy: { id: 'desc' },
    });
    expect(row.actorRole).toBe('STREAMER');
    expect(row.metadata).toEqual({ method: 'google', stepUp: true });
    expect(row.hash).toHaveLength(32);
  });

  it('rejects metadata outside the allow-list (no PII can slip in)', async () => {
    await expect(
      audit({
        action: 'auth.login',
        actor: null,
        targetType: 'User',
        // @ts-expect-error — e-mail is not an allowed key
        metadata: { method: 'google', stepUp: false, email: 'someone@example.com' },
      }),
    ).rejects.toThrow();
  });

  it('keeps a valid chain under concurrent writers', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        audit({
          action: 'auth.logout',
          actor: null,
          targetType: 'Session',
          targetId: `s${i}`,
          metadata: { scope: 'current' },
        }),
      ),
    );
    const result = await verifyAuditChain(db());
    expect(result.ok).toBe(true);
    expect(result.checked).toBeGreaterThanOrEqual(26);
  });
});

describe('hash-chain verifier', () => {
  it('detects an altered row (tamper test)', async () => {
    await audit({
      action: 'auth.logout',
      actor: null,
      targetType: 'Session',
      targetId: 'victim',
      metadata: { scope: 'current' },
    });
    expect((await verifyAuditChain(db())).ok).toBe(true);

    // An attacker with superuser access disables the guard trigger and edits history.
    const victim = await db().auditLog.findFirstOrThrow({ where: { targetId: 'victim' } });
    await withAdmin(async (c) => {
      await c.query('ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_update');
      await c.query(`UPDATE "AuditLog" SET metadata = '{"scope":"forged"}' WHERE id = $1`, [
        victim.id.toString(),
      ]);
      await c.query('ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_update');
    });

    const result = await verifyAuditChain(db());
    expect(result).toMatchObject({ ok: false, badId: victim.id, reason: 'hash' });
    expect(await runAuditVerify()).toBe(false);

    // Re-computing that row's hash to hide the edit breaks the NEXT row's link instead.
    await audit({
      action: 'auth.logout',
      actor: null,
      targetType: 'Session',
      targetId: 'after',
      metadata: { scope: 'current' },
    });
    await withAdmin(async (c) => {
      await c.query('ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_update');
      await c.query(`UPDATE "AuditLog" a SET hash = audit_log_expected_hash(a) WHERE id = $1`, [
        victim.id.toString(),
      ]);
      await c.query('ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_update');
    });
    const relinked = await verifyAuditChain(db());
    expect(relinked.ok).toBe(false);
    if (!relinked.ok) {
      expect(relinked.reason).toBe('link');
      expect(relinked.badId > victim.id).toBe(true);
    }
  });

  it('detects a row deleted from the middle of the chain', async () => {
    await resetAuditLog();
    for (const id of ['m1', 'm2', 'm3']) {
      await audit({
        action: 'auth.logout',
        actor: null,
        targetType: 'Session',
        targetId: id,
        metadata: { scope: 'current' },
      });
    }
    expect(await verifyAuditChain(db())).toMatchObject({ ok: true, checked: 3 });
    const m2 = await db().auditLog.findFirstOrThrow({ where: { targetId: 'm2' } });
    const m3 = await db().auditLog.findFirstOrThrow({ where: { targetId: 'm3' } });
    await withAdmin(async (c) => {
      await c.query('ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_update');
      await c.query('DELETE FROM "AuditLog" WHERE id = $1', [m2.id.toString()]);
      await c.query('ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_update');
    });
    expect(await verifyAuditChain(db())).toMatchObject({ ok: false, badId: m3.id, reason: 'link' });
  });

  it('reports the head anchor (id + hash) of an intact chain', async () => {
    await resetAuditLog();
    await audit({
      action: 'auth.logout',
      actor: null,
      targetType: 'Session',
      targetId: 'h1',
      metadata: { scope: 'current' },
    });
    const result = await verifyAuditChain(db());
    const h1 = await db().auditLog.findFirstOrThrow({ where: { targetId: 'h1' } });
    expect(result).toEqual({
      ok: true,
      checked: 1,
      head: { id: h1.id, hash: Buffer.from(h1.hash!).toString('hex') },
    });
    expect(await runAuditVerify()).toBe(true);
  });
});
