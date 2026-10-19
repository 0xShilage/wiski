/**
 * Production-like stack for the browser tests (run by Playwright's webServer):
 *   embedded Postgres 17 + migrations + the dev seed · redis-server · standalone Next.js build (NODE_ENV=production,
 *   production-valid env) · nginx with the real security-header snippet, TLS on https://localhost.
 * Writes test-results/e2e-stack.json for the specs (DB URL for seeding sessions).
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { applyMigrations } from '../../integration/setup/global-setup';

const ROOT = join(import.meta.dirname, '../../..');
export const HTTPS_PORT = Number(process.env.E2E_HTTPS_PORT ?? 8443);
const APP_PORT = 3100;
const PG_PORT = 54331;
const REDIS_PORT = 63791;
const children: ChildProcess[] = [];

async function main() {
  const standalone = join(ROOT, '.next/standalone');
  if (!existsSync(join(standalone, 'server.js'))) throw new Error('run `npm run build` first');
  // Same layout the Docker image uses: static assets next to the standalone server.
  cpSync(join(ROOT, 'public'), join(standalone, 'public'), { recursive: true });
  cpSync(join(ROOT, '.next/static'), join(standalone, '.next/static'), { recursive: true });

  const tmp = mkdtempSync(join(tmpdir(), 'wf-e2e-'));
  // MEDIA_DIR: written by the app, read by nginx workers (unprivileged) → traversable/readable.
  const mediaDir = join(tmp, 'media');
  mkdirSync(mediaDir, { mode: 0o755 });
  chmodSync(tmp, 0o711);
  // Separate dir: embedded-postgres hands it to the `postgres` user when running as root.
  const pgDir = mkdtempSync(join(tmpdir(), 'wf-e2e-pg-'));
  const pgServer = new EmbeddedPostgres({
    databaseDir: pgDir,
    port: PG_PORT,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    createPostgresUser: process.getuid?.() === 0,
    onLog: () => {},
    onError: () => {},
  });
  await pgServer.initialise();
  await pgServer.start();
  const admin = new pg.Client({
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`,
  });
  await admin.connect();
  await admin.query(`CREATE ROLE wf_migrator LOGIN PASSWORD 'migrator'`);
  await admin.query(`CREATE ROLE wf_app LOGIN PASSWORD 'app' NOINHERIT`);
  await admin.query(`CREATE DATABASE wiskiflix OWNER wf_migrator`);
  await admin.end();
  const su = new pg.Client({
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/wiskiflix`,
  });
  await su.connect();
  await su.query(
    'REVOKE ALL ON SCHEMA public FROM PUBLIC; ALTER SCHEMA public OWNER TO wf_migrator',
  );
  await su.end();
  const migrator = new pg.Client({
    connectionString: `postgresql://wf_migrator:migrator@127.0.0.1:${PG_PORT}/wiskiflix`,
  });
  await migrator.connect();
  await applyMigrations(migrator);
  await migrator.end();

  children.push(
    spawn(
      'redis-server',
      ['--port', String(REDIS_PORT), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'],
      { stdio: 'ignore' },
    ),
  );

  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
      '-keyout',
      join(tmp, 'key.pem'),
      '-out',
      join(tmp, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );

  const origin = `https://localhost:${HTTPS_PORT}`;
  const appEnv = {
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'production' as const,
    PORT: String(APP_PORT),
    HOSTNAME: '127.0.0.1',
    NEXT_TELEMETRY_DISABLED: '1',
    APP_ORIGIN: origin,
    DATABASE_URL: `postgresql://wf_app:app@127.0.0.1:${PG_PORT}/wiskiflix`,
    REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}`,
    CSRF_SECRET: 'e2e-csrf-secret-e2e-csrf-secret-e2e-csrf-secret',
    COOKIE_SEAL_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    IP_HASH_SECRET: 'e2e-ip-hash-secret-e2e-ip-hash-secret-e2e-ip-h',
    CLIENT_IP_HEADER: 'x-real-ip',
    // Production rules apply: real-looking (never contacted) Google/Turnstile config.
    GOOGLE_CLIENT_ID: 'e2e-placeholder.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'e2e-placeholder-client-secret',
    TURNSTILE_SITE_KEY: '0x4AAAAAAAe2e-site-key',
    TURNSTILE_SECRET_KEY: '0x4AAAAAAAe2e-secret-key',
    MEDIA_DIR: mediaDir,
    LOG_LEVEL: 'warn',
  };
  // R1: the fictional catalogue (scripts/seed-dev.ts) through the real services and media
  // pipeline, so the pages, carousel and dashboard have every state to show.
  execFileSync(
    process.execPath,
    [
      join(ROOT, 'node_modules/tsx/dist/cli.mjs'),
      '--conditions=react-server',
      'scripts/seed-dev.ts',
    ],
    {
      cwd: ROOT,
      env: { ...appEnv, NODE_ENV: 'test', LOG_LEVEL: 'error' },
      stdio: ['ignore', 'ignore', 'inherit'],
      timeout: 240_000,
    },
  );

  const app = spawn(process.execPath, [join(standalone, 'server.js')], {
    env: appEnv,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(app);

  const conf = readFileSync(join(ROOT, 'tests/e2e/nginx/nginx.conf.template'), 'utf8')
    .replaceAll('__TMP__', tmp)
    .replaceAll('__APP_PORT__', String(APP_PORT))
    .replaceAll('__HTTPS_PORT__', String(HTTPS_PORT))
    .replaceAll('__SNIPPET__', join(ROOT, 'docker/nginx/snippets/security-headers.conf'))
    .replaceAll('__MEDIA_SNIPPET__', join(ROOT, 'docker/nginx/snippets/media.conf'))
    .replaceAll('__UPLOAD_SNIPPET__', join(ROOT, 'docker/nginx/snippets/upload.conf'))
    .replaceAll('__MEDIA_DIR__', mediaDir);
  writeFileSync(join(tmp, 'nginx.conf'), conf);
  const nginx = spawn('nginx', ['-c', join(tmp, 'nginx.conf'), '-p', tmp, '-g', 'daemon off;'], {
    stdio: 'inherit',
  });
  children.push(nginx);

  mkdirSync(join(ROOT, 'test-results'), { recursive: true });
  writeFileSync(
    join(ROOT, 'test-results/e2e-stack.json'),
    JSON.stringify(
      {
        origin,
        adminDatabaseUrl: `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/wiskiflix`,
        appEnv,
      },
      null,
      2,
    ),
  );

  const stop = async () => {
    for (const c of children) c.kill('SIGTERM');
    await pgServer.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
  for (const [name, proc] of [
    ['app', app],
    ['nginx', nginx],
  ] as const) {
    proc.on('exit', (code) => {
      console.error(`[e2e-stack] ${name} exited with ${code}`);
      void stop();
    });
  }
}

await main();
