/**
 * Every shell script in the repository is executable as committed (2026-11-03): the server runs
 * them straight from the checkout (server-setup.sh calls firewall.sh, the systemd units run
 * backup.sh, firewall.sh and cloudflare-ips.sh), and deploy.sh refuses a checkout with local
 * changes, so a `chmod +x` on the server is not an option.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');

function trackedScripts(): { mode: string; path: string }[] {
  const out = execFileSync('git', ['ls-files', '-s', '--', '*.sh'], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      return { mode: meta!.split(' ')[0]!, path: path! };
    });
}

describe('shell scripts', () => {
  it('are committed with the executable bit (mode 100755)', () => {
    const scripts = trackedScripts();
    expect(scripts.length).toBeGreaterThan(5);
    expect(scripts.filter((s) => s.mode !== '100755').map((s) => s.path)).toEqual([]);
  });
});

describe('deploy.sh and the nginx template (2026-11-11)', () => {
  it('restarts nginx so a changed site template is rendered again (a reload kept the old one)', () => {
    const sh = readFileSync(join(ROOT, 'scripts/ops/deploy.sh'), 'utf8');
    expect(sh).toMatch(/^"\$\{COMPOSE\[@\]\}" restart nginx$/m);
    expect(sh).not.toMatch(/nginx -s reload/);
    expect(sh).toMatch(/die "nginx did not come back/);
  });
});
