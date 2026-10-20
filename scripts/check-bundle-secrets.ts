/**
 * Fails the build if secrets reach the browser bundle (05 §12): scans .next/static/** for
 * the values of every secret env var present in this environment, and for well-known token
 * prefixes (Mercado Pago, Google OAuth client secrets, private keys).
 *
 * Run after `next build`: npm run check:bundle-secrets
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STATIC = join(import.meta.dirname, '../.next/static');
const SECRET_KEYS = [
  'CSRF_SECRET',
  'COOKIE_SEAL_KEY',
  'COOKIE_SEAL_KEY_PREVIOUS',
  'IP_HASH_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'TURNSTILE_SECRET_KEY',
  'MP_ACCESS_TOKEN',
  'MP_WEBHOOK_SECRET',
  'MP_WEBHOOK_SECRET_PREVIOUS',
  'RESEND_API_KEY',
  'DATABASE_URL',
  'MIGRATE_DATABASE_URL',
  'REDIS_URL',
];
const PATTERNS: [string, RegExp][] = [
  ['Mercado Pago access token', /APP_USR-\d{6,}-\d{6}-[0-9a-f]{20,}-\d+/],
  ['Mercado Pago test token', /TEST-\d{6,}-\d{6}-[0-9a-f]{20,}-\d+/],
  ['Google OAuth client secret', /GOCSPX-[\w-]{20,}/],
  ['Resend API key', /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['postgres URL with password', /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@/],
];

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(?:js|css|json|html|txt|map)$/.test(name)) yield p;
  }
}

const secrets = SECRET_KEYS.map((k) => [k, process.env[k]] as const).filter(
  (e): e is readonly [string, string] => !!e[1] && e[1].length >= 8,
);
const findings: string[] = [];
let scanned = 0;
for (const file of files(STATIC)) {
  scanned++;
  const text = readFileSync(file, 'utf8');
  for (const [key, value] of secrets)
    if (text.includes(value)) findings.push(`${file}: value of ${key}`);
  for (const [label, re] of PATTERNS)
    if (re.test(text)) findings.push(`${file}: looks like a ${label}`);
}
if (findings.length) {
  console.error(
    `Secrets found in the client bundle:\n${findings.map((f) => `  - ${f}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(
  `bundle secret scan: ${scanned} files clean (${secrets.length} env secrets + ${PATTERNS.length} patterns)`,
);
