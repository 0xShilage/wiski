/**
 * Integration test infrastructure (10 §0): Postgres 17 from the `embedded-postgres` npm package
 * (no Docker needed) and a local `redis-server`. Applies prisma/migrations/*.sql in order as the
 * migrator role, then hands the app-role (wf_app, DML only) URL to the tests — exactly the
 * production privilege split.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    adminDatabaseUrl: string;
    redisUrl: string;
  }
}

const ROOT = join(import.meta.dirname, '../../..');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() =>
        typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port')),
      );
    });
  });
}

export async function applyMigrations(client: pg.Client): Promise<string[]> {
  const dir = join(ROOT, 'prisma/migrations');
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of names) {
    const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${name} failed: ${(err as Error).message}`);
    }
  }
  return names;
}

export default async function setup(project: TestProject) {
  // Postgres refuses to run as root; the data dir must be reachable by the `postgres` user.
  const dataDir = mkdtempSync(join(tmpdir(), 'wf-it-pg-'));
  const pgPort = await freePort();
  const pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: pgPort,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    createPostgresUser: process.getuid?.() === 0,
    initdbFlags: ['--encoding=UTF8', '--locale=C.UTF-8'],
    onLog: () => {},
    onError: () => {},
  });
  await pgServer.initialise();
  await pgServer.start();

  const admin = new pg.Client({
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${pgPort}/postgres`,
  });
  await admin.connect();
  await admin.query(`CREATE ROLE wf_migrator LOGIN PASSWORD 'migrator' NOSUPERUSER NOCREATEROLE`);
  await admin.query(
    `CREATE ROLE wf_app LOGIN PASSWORD 'app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
  );
  await admin.query(`CREATE DATABASE wiskiflix_test OWNER wf_migrator`);
  await admin.end();

  const superDb = new pg.Client({
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${pgPort}/wiskiflix_test`,
  });
  await superDb.connect();
  await superDb.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await superDb.query('ALTER SCHEMA public OWNER TO wf_migrator');
  await superDb.end();

  const migrator = new pg.Client({
    connectionString: `postgresql://wf_migrator:migrator@127.0.0.1:${pgPort}/wiskiflix_test`,
  });
  await migrator.connect();
  await applyMigrations(migrator);
  await migrator.end();

  // Redis: a throw-away local server, no persistence.
  const redisPort = await freePort();
  const redisProc: ChildProcess = spawn(
    'redis-server',
    ['--port', String(redisPort), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'],
    { stdio: 'ignore' },
  );
  await new Promise((r) => setTimeout(r, 300));

  project.provide('databaseUrl', `postgresql://wf_app:app@127.0.0.1:${pgPort}/wiskiflix_test`);
  project.provide(
    'adminDatabaseUrl',
    `postgresql://postgres:postgres@127.0.0.1:${pgPort}/wiskiflix_test`,
  );
  project.provide('redisUrl', `redis://127.0.0.1:${redisPort}`);

  return async () => {
    redisProc.kill('SIGTERM');
    await pgServer.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
}
