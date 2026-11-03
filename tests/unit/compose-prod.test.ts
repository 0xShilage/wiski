/**
 * docker/compose.prod.yml as Docker Compose resolves it (`docker compose config --format json`,
 * with throw-away placeholder files for the server's secrets): every long-running service keeps
 * the hardening the threat model asks for (05 §10) and the memory budget of 08 §1.
 * Skipped where the Docker CLI is not installed.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');
const hasCompose = (() => {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

type Service = {
  image?: string;
  read_only?: boolean;
  cap_drop?: string[];
  cap_add?: string[];
  security_opt?: string[];
  ports?: { published?: string; target: number }[];
  networks?: Record<string, unknown>;
  deploy?: { resources?: { limits?: { memory?: string | number; pids?: number } } };
  logging?: { driver?: string; options?: Record<string, string> };
  environment?: Record<string, string>;
  secrets?: { source: string }[];
  profiles?: string[];
  healthcheck?: { test?: string[]; disable?: boolean };
  restart?: string;
};

function resolved(): {
  services: Record<string, Service>;
  networks: Record<string, { internal?: boolean }>;
} {
  const etc = mkdtempSync(join(tmpdir(), 'wf-compose-'));
  mkdirSync(join(etc, 'secrets'));
  mkdirSync(join(etc, 'tls'));
  // empty placeholders: compose only checks that they exist
  for (const f of ['app', 'migrate']) writeFileSync(join(etc, `${f}.env`), '');
  for (const f of ['pg_superuser', 'pg_migrator', 'pg_app', 'redis'])
    writeFileSync(join(etc, 'secrets', f), '');
  const out = execFileSync(
    'docker',
    [
      'compose',
      '-f',
      join(ROOT, 'docker/compose.prod.yml'),
      '--profile',
      'ops',
      'config',
      '--format',
      'json',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        WF_ETC: etc,
        WF_IMAGE: 'ghcr.io/example/wiski@sha256:' + 'a'.repeat(64),
        WF_MIGRATE_IMAGE: 'ghcr.io/example/wiski-migrate@sha256:' + 'b'.repeat(64),
      },
    },
  );
  return JSON.parse(out);
}

const mib = (v: string | number | undefined) => Number(v) / 2 ** 20;

describe.skipIf(!hasCompose)('production compose file', () => {
  const cfg = hasCompose ? resolved() : { services: {}, networks: {} };
  const longRunning = Object.entries(cfg.services).filter(([, s]) => !s.profiles?.includes('ops'));

  it('has exactly the planned services', () => {
    expect(Object.keys(cfg.services).sort()).toEqual(
      ['migrate', 'nginx', 'postgres', 'redis', 'web', 'worker'].sort(),
    );
  });

  it('hardening on every service: read-only, no capabilities by default, no new privileges, capped logs', () => {
    for (const [name, s] of Object.entries(cfg.services)) {
      expect(s.read_only, name).toBe(true);
      expect(s.cap_drop, name).toEqual(['ALL']);
      expect(s.security_opt, name).toContain('no-new-privileges:true');
      expect(s.logging?.driver, name).toBe('json-file');
      expect(s.logging?.options?.['max-size'], name).toBe('10m');
    }
    // only the infrastructure images get a few capabilities back; the app gets none
    expect(cfg.services.web!.cap_add ?? []).toEqual([]);
    expect(cfg.services.worker!.cap_add ?? []).toEqual([]);
    expect(cfg.services.nginx!.cap_add!.sort()).toEqual([
      'CHOWN',
      'NET_BIND_SERVICE',
      'SETGID',
      'SETUID',
    ]);
    for (const s of Object.values(cfg.services)) expect(s.cap_add ?? []).not.toContain('SYS_ADMIN');
  });

  it('only nginx publishes ports; databases sit on an internal network', () => {
    for (const [name, s] of Object.entries(cfg.services)) {
      if (name === 'nginx') {
        expect((s.ports ?? []).map((p) => p.target).sort()).toEqual([443, 80]);
      } else {
        expect(s.ports ?? [], name).toEqual([]);
      }
    }
    expect(cfg.networks.data?.internal).toBe(true);
    expect(Object.keys(cfg.services.postgres!.networks!)).toEqual(['data']);
    expect(Object.keys(cfg.services.redis!.networks!)).toEqual(['data']);
  });

  it('every long-running service has a healthcheck (`up --wait` refuses one without)', () => {
    for (const [name, s] of longRunning) {
      expect(s.healthcheck?.disable ?? false, name).toBe(false);
      expect(s.healthcheck?.test?.length ?? 0, name).toBeGreaterThan(0);
    }
    // the worker serves no HTTP: its healthcheck reads the heartbeat file src/worker/main.ts writes
    expect(cfg.services.worker!.healthcheck!.test!.join(' ')).toContain('/tmp/wf-worker-alive');
  });

  it('memory limits fit the 2 GB budget (08 §1) and every long-running service restarts', () => {
    const limits = Object.fromEntries(
      longRunning.map(([n, s]) => [n, mib(s.deploy?.resources?.limits?.memory)]),
    );
    expect(limits).toEqual({ nginx: 64, web: 448, worker: 256, postgres: 384, redis: 128 });
    const total = Object.values(limits).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(1300);
    for (const [name, s] of longRunning) {
      expect(s.restart, name).toBe('unless-stopped');
      expect(s.deploy?.resources?.limits?.pids, name).toBeGreaterThan(0);
    }
  });

  it('secrets come from files, never from inline values; images are pinned by digest', () => {
    expect(cfg.services.postgres!.environment!.POSTGRES_PASSWORD_FILE).toBe(
      '/run/secrets/pg_superuser',
    );
    expect(cfg.services.postgres!.environment).not.toHaveProperty('POSTGRES_PASSWORD');
    expect(cfg.services.redis!.secrets!.map((s) => s.source)).toEqual(['redis']);
    expect(cfg.services.web!.image).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(cfg.services.worker!.image).toBe(cfg.services.web!.image);
    const text = JSON.stringify(cfg);
    expect(text).not.toMatch(/PASSWORD=|SECRET=|postgresql:\/\/[^"/:@]*:[^"/@]+@/i);
  });
});
