// The full `npm audit` gate (dev dependencies included, high and critical), with a short,
// expiring allowlist for advisories that have no fix yet (scripts/audit-allowlist.json).
// An advisory passes only if it is listed, unexpired and for the named package. Anything else at
// high or critical fails the run, as `npm audit --audit-level=high` did.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
const FAIL_AT = LEVELS.indexOf('high');

const allow = JSON.parse(readFileSync(new URL('./audit-allowlist.json', import.meta.url), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const active = new Map();
for (const a of allow.advisories) {
  if (a.expires < today) {
    console.log(`allowlist: ${a.id} (${a.package}) expired on ${a.expires}; it counts again`);
    continue;
  }
  active.set(a.id, a);
}

let raw;
try {
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
} catch (err) {
  raw = err.stdout; // npm audit exits non-zero when it finds anything
}
const report = JSON.parse(raw);
if (report.error) {
  console.error('npm audit failed:', report.error.summary ?? report.error);
  process.exit(1);
}

const seen = new Map();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via !== 'object') continue; // a dependency path; its advisory is listed on its own
    const id = String(via.url ?? '')
      .split('/')
      .pop();
    if (!seen.has(id))
      seen.set(id, { id, package: via.name, severity: via.severity, title: via.title });
  }
}

let failed = 0;
for (const a of seen.values()) {
  const level = LEVELS.indexOf(a.severity);
  const ok = active.get(a.id);
  if (ok && ok.package === a.package) {
    console.log(`allowed until ${ok.expires}: ${a.severity} ${a.package} ${a.id} — ${a.title}`);
  } else if (level >= FAIL_AT) {
    console.log(`FAIL: ${a.severity} ${a.package} ${a.id} — ${a.title}`);
    failed++;
  } else {
    console.log(`below the gate: ${a.severity} ${a.package} ${a.id} — ${a.title}`);
  }
}
if (failed) {
  console.log(
    `\n${failed} advisor${failed === 1 ? 'y' : 'ies'} at high or critical. Run \`npm audit\` for the paths.`,
  );
  process.exit(1);
}
console.log('npm audit (all dependencies): nothing at high or critical outside the allowlist');
