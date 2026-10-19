import { inject } from 'vitest';
import pg from 'pg';
import { db } from '@/server/db';

/** Superuser connection for test setup/tampering only (the app itself runs as wf_app). */
export async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject('adminDatabaseUrl') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

let seq = 0;
/** Create a user directly (bypassing Google) for tests. */
export async function makeUser(
  over: {
    role?: 'USER' | 'MODERATOR' | 'STREAMER' | undefined;
    username?: string | null | undefined;
    status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED' | undefined;
  } = {},
) {
  seq++;
  const tag = `${Date.now().toString(36)}${seq}`;
  return db().user.create({
    data: {
      googleSub: `test-sub-${tag}`,
      email: `user${tag}@example.com`,
      emailVerified: true,
      username: over.username === undefined ? `user_${tag}`.slice(0, 20) : over.username,
      role: over.role ?? 'USER',
      status: over.status ?? 'ACTIVE',
    },
  });
}

/** Test-only: wipe the audit log (needs superuser + disabling the guard trigger). */
export async function resetAuditLog(): Promise<void> {
  await withAdmin(async (c) => {
    await c.query('ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_truncate');
    await c.query('TRUNCATE "AuditLog"');
    await c.query('ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_truncate');
  });
}
