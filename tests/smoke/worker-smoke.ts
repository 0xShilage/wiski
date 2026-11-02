/**
 * Smoke test for the production worker bundle (Phase 5): dist/worker.mjs, run from the standalone
 * server's directory exactly as the image runs it, against a real Postgres 17 (all migrations) and
 * Redis. Passes when the worker starts, runs its jobs for a few seconds without a failure and
 * exits 0 on SIGTERM.   npm run build && npm run build:worker && npm run smoke:worker
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { applyMigrations } from '../integration/setup/global-setup';

const ROOT = join(import.meta.dirname, '../..');
const PG_PORT = 54341;
const REDIS_PORT = 63801;
const standalone = join(ROOT, '.next/standalone');
mkdirSync(join(standalone, 'dist'), { recursive: true });
copyFileSync(join(ROOT, 'dist/worker.mjs'), join(standalone, 'dist/worker.mjs'));

const pgDir = mkdtempSync(join(tmpdir(), 'wf-smoke-pg-'));
const server = new EmbeddedPostgres({
  databaseDir: pgDir,
  port: PG_PORT,
  user: 'postgres',
  password: 'postgres',
  persistent: false,
  createPostgresUser: process.getuid?.() === 0,
  onLog: () => {},
  onError: () => {},
});
await server.initialise();
await server.start();
const redis = spawn(
  'redis-server',
  ['--port', String(REDIS_PORT), '--save', '', '--appendonly', 'no'],
  {
    stdio: 'ignore',
  },
);
let failed = false;
try {
  const admin = new pg.Client({
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`,
  });
  await admin.connect();
  await admin.query(`CREATE ROLE wf_migrator LOGIN PASSWORD 'migrator'`);
  await admin.query(`CREATE ROLE wf_app LOGIN PASSWORD 'app'`);
  await admin.query(`CREATE DATABASE wiskiflix OWNER wf_migrator`);
  await admin.end();
  const mig = new pg.Client({
    connectionString: `postgresql://wf_migrator:migrator@127.0.0.1:${PG_PORT}/wiskiflix`,
  });
  await mig.connect();
  await applyMigrations(mig);
  await mig.end();

  const key = (b: number) => Buffer.alloc(32, b).toString('base64url');
  const env = {
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'production' as const,
    APP_ORIGIN: 'https://wiski.example',
    DATABASE_URL: `postgresql://wf_app:app@127.0.0.1:${PG_PORT}/wiskiflix`,
    REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}`,
    CSRF_SECRET: key(1),
    COOKIE_SEAL_KEY: key(2),
    IP_HASH_SECRET: key(3),
    TOTP_ENCRYPTION_KEY: key(4),
    GOOGLE_CLIENT_ID: 'smoke.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'smoke-placeholder-secret',
    TURNSTILE_SITE_KEY: '0x4AAAAAAAsmoke-site',
    TURNSTILE_SECRET_KEY: '0x4AAAAAAAsmoke-secret',
    MEDIA_DIR: mkdtempSync(join(tmpdir(), 'wf-smoke-media-')),
    LOG_LEVEL: 'info',
  };
  const worker = spawn(process.execPath, ['--conditions=react-server', 'dist/worker.mjs'], {
    cwd: standalone,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  worker.stdout.on('data', (d) => (out += String(d)));
  worker.stderr.on('data', (d) => (out += String(d)));
  await new Promise((r) => setTimeout(r, 8000));
  worker.kill('SIGTERM');
  const code = await new Promise<number | null>((r) => worker.on('exit', r));
  const started = out.includes('worker started');
  const jobFailed = /job failed|worker crashed/.test(out);
  console.log(out.split('\n').slice(0, 12).join('\n'));
  console.log(`started=${started} jobFailed=${jobFailed} exit=${code}`);
  failed = !started || jobFailed || code !== 0;
} finally {
  redis.kill();
  await server.stop().catch(() => {});
  spawnSync('true');
}
process.exit(failed ? 1 : 0);
