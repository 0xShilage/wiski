/**
 * Apply every migration to MIGRATE_DATABASE_URL (smoke tests / restore drill) and record them in
 * `_prisma_migrations` exactly as `prisma migrate deploy` does (same table, sha256 checksums), so
 * the database looks like a production one. Production itself runs the real Prisma CLI (the
 * `migrate` image).
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { applyMigrations } from '../integration/setup/global-setup';

const c = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
await c.connect();
const applied = await applyMigrations(c);
await c.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
await c.query('REVOKE ALL ON "_prisma_migrations" FROM wf_app').catch(() => {});
for (const name of applied) {
  const sql = readFileSync(
    join(import.meta.dirname, '../../prisma/migrations', name, 'migration.sql'),
  );
  await c.query(
    `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
     VALUES ($1, $2, now(), $3, 1)`,
    [randomUUID(), createHash('sha256').update(sql).digest('hex'), name],
  );
}
await c.end();
console.log(`applied ${applied.length} migrations`);
