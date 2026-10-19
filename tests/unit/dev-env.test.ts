import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/server/env';

describe('npm run setup:dev', () => {
  it('writes a .env.local that passes env validation, with fresh distinct secrets', () => {
    const read = () => {
      const dir = mkdtempSync(join(tmpdir(), 'wf-devenv-'));
      execFileSync(
        process.execPath,
        [join(import.meta.dirname, '../../scripts/setup-dev-env.mjs')],
        { cwd: dir },
      );
      return Object.fromEntries(
        readFileSync(join(dir, '.env.local'), 'utf8')
          .split('\n')
          .filter((l) => l && !l.startsWith('#'))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      ) as Record<string, string>;
    };
    const a = read();
    const b = read();
    expect(() => parseEnv({ ...a, NODE_ENV: 'development' })).not.toThrow();
    expect(a.CSRF_SECRET).not.toBe(b.CSRF_SECRET);
    expect(new Set([a.CSRF_SECRET, a.COOKIE_SEAL_KEY, a.IP_HASH_SECRET]).size).toBe(3);
  });
});
