#!/usr/bin/env node
/**
 * Production check (Phase 5 exit criteria): the headers Mozilla Observatory grades, scored with
 * Observatory's own modifiers (A+ = score ≥ 100 with no failed test), every security header
 * exactly once, the redirects, the TLS policy and the parts that must NOT be reachable.
 * Plain Node ≥ 22, no dependencies.
 *
 *   node scripts/ops/check-site.mjs https://wiski.fun
 *   node scripts/ops/check-site.mjs https://localhost:8443 --insecure --http-port 8081   (browser-test stack)
 *   node scripts/ops/check-site.mjs https://wiski.fun --origin-ip 203.0.113.7   (+ origin lockdown)
 *
 * Exit 0 when everything passes. Prints one line per check and a JSON summary at the end.
 * The real Observatory / SSL Labs scans stay on the go-live checklist; this is the same check,
 * runnable before launch and after every deploy.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import tls from 'node:tls';

const args = process.argv.slice(2);
const base = new URL(args.find((a) => /^https:\/\//.test(a)) ?? 'https://wiski.fun');
const insecure = args.includes('--insecure');
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const httpPort = opt('--http-port') ?? '80';
const originIp = opt('--origin-ip');

const results = [];
const pass = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function fetchRaw(url, { method = 'GET', host, servername } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = mod(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: { host: host ?? u.host, 'user-agent': 'wiskiflix-check-site' },
        servername: servername ?? u.hostname,
        rejectUnauthorized: !insecure,
        timeout: 10_000,
      },
      (res) => {
        const raw = res.rawHeaders;
        const headers = new Map();
        for (let i = 0; i < raw.length; i += 2) {
          const k = raw[i].toLowerCase();
          headers.set(k, [...(headers.get(k) ?? []), raw[i + 1]]);
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body.length < 400_000 ? (body += c) : null));
        res.on('end', () => resolve({ status: res.statusCode, headers, body }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const one = (h, name) => (h.get(name) ?? []).length === 1;
const val = (h, name) => (h.get(name) ?? [])[0] ?? '';

function parseCsp(csp) {
  const d = new Map();
  for (const part of csp.split(';')) {
    const [k, ...v] = part.trim().split(/\s+/);
    if (k) d.set(k.toLowerCase(), v);
  }
  return d;
}

/** Mozilla Observatory (v2) scoring for the tests that apply to this site. */
function observatory(home) {
  const h = home.headers;
  let score = 100;
  const tests = [];
  const t = (name, ok, modifier) => {
    tests.push({ name, ok, modifier });
    score += modifier;
  };
  // Content Security Policy
  const csp = parseCsp(val(h, 'content-security-policy'));
  const scriptSrc = csp.get('script-src') ?? csp.get('default-src') ?? [];
  const styleSrc = csp.get('style-src') ?? csp.get('default-src') ?? [];
  const unsafeScript =
    scriptSrc.includes("'unsafe-inline'") &&
    !scriptSrc.some((s) => s.startsWith("'nonce-") || s.startsWith("'sha"));
  const unsafeEval = scriptSrc.includes("'unsafe-eval'");
  const unsafeStyle = styleSrc.includes("'unsafe-inline'");
  const insecureSources = [...csp.values()]
    .flat()
    .some((s) => s === 'http:' || s === '*' || s.startsWith('http://'));
  if (!csp.size) t('csp-not-implemented', false, -25);
  else if (unsafeScript || unsafeEval || insecureSources)
    t('csp-implemented-with-unsafe', false, -20);
  else if (unsafeStyle) t('csp-implemented-with-unsafe-inline-in-style-src-only', true, 0);
  else if ((csp.get('default-src') ?? []).join(' ') === "'none'")
    t('csp-implemented-with-no-unsafe-default-src-none', true, 10);
  else t('csp-implemented-with-no-unsafe', true, 0);
  const ok = (dir) => csp.has(dir);
  if (!ok('object-src') && !(csp.get('default-src') ?? []).includes("'none'"))
    t('csp-object-src-missing', false, 0);
  // Cookies (session cookies must be Secure + HttpOnly + SameSite)
  const cookies = h.get('set-cookie') ?? [];
  if (!cookies.length) t('cookies-not-found', true, 0);
  else {
    const allGood = cookies.every(
      (c) =>
        /;\s*secure/i.test(c) && /;\s*httponly/i.test(c) && /;\s*samesite=(?:lax|strict)/i.test(c),
    );
    t(
      allGood
        ? 'cookies-secure-with-httponly-sessions-and-samesite'
        : 'cookies-without-secure-flag',
      allGood,
      allGood ? 5 : -20,
    );
  }
  // CORS
  const acao = val(h, 'access-control-allow-origin');
  t(
    acao === '*'
      ? 'cross-origin-resource-sharing-implemented-with-universal-access'
      : 'cross-origin-resource-sharing-not-implemented',
    acao !== '*',
    acao === '*' ? -50 : 0,
  );
  // Referrer-Policy
  const rp = val(h, 'referrer-policy');
  const privateRp = [
    'no-referrer',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin',
  ].includes(rp);
  t(
    privateRp ? 'referrer-policy-private' : 'referrer-policy-unsafe',
    privateRp,
    privateRp ? 5 : -5,
  );
  // HSTS
  const hsts = val(h, 'strict-transport-security');
  const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
  t(
    maxAge >= 15_768_000
      ? 'hsts-implemented-max-age-at-least-six-months'
      : `hsts-not-implemented (received: ${hsts || 'none'})`,
    maxAge >= 15_768_000,
    maxAge >= 15_768_000 ? 0 : -20,
  );
  // Subresource Integrity: every script is same-origin over HTTPS
  const external = [...home.body.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((s) => /^https?:\/\//.test(s) && !s.startsWith(base.origin));
  t(
    external.length
      ? `sri-not-implemented-and-external-scripts-loaded-securely (${external.join(' ')})`
      : 'sri-not-implemented-but-all-scripts-loaded-from-secure-origin',
    !external.length,
    external.length ? -5 : 0,
  );
  // X-Content-Type-Options
  const nosniff = val(h, 'x-content-type-options').toLowerCase() === 'nosniff';
  t(
    nosniff ? 'x-content-type-options-nosniff' : 'x-content-type-options-not-implemented',
    nosniff,
    nosniff ? 0 : -5,
  );
  // X-Frame-Options / frame-ancestors
  const fa = (csp.get('frame-ancestors') ?? []).join(' ');
  if (fa === "'none'" || fa === "'self'") t('x-frame-options-implemented-via-csp', true, 5);
  else if (/^(?:deny|sameorigin)$/i.test(val(h, 'x-frame-options')))
    t('x-frame-options-sameorigin-or-deny', true, 0);
  else t('x-frame-options-not-implemented', false, -20);
  // Cross-Origin-Resource-Policy
  const corp = val(h, 'cross-origin-resource-policy');
  t(corp ? 'corp-implemented-with-same-origin' : 'corp-not-implemented', true, 0);
  const failed = tests.filter((x) => !x.ok);
  const grade = failed.length ? 'fail' : score >= 100 ? 'A+' : score >= 90 ? 'A' : 'B or lower';
  return { score, grade, tests };
}

async function tlsHandshake(opts) {
  return new Promise((resolve) => {
    const s = tls.connect(
      {
        host: base.hostname,
        port: Number(base.port || 443),
        servername: base.hostname,
        rejectUnauthorized: !insecure,
        ...opts,
      },
      () => {
        resolve({ ok: true, protocol: s.getProtocol(), cipher: s.getCipher()?.name });
        s.end();
      },
    );
    s.setTimeout(8000, () => s.destroy(new Error('timeout')));
    s.on('error', (e) => resolve({ ok: false, error: e.code ?? e.message }));
  });
}

const NGINX_HEADERS = [
  'strict-transport-security',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
];

try {
  const home = await fetchRaw(new URL('/', base).href);
  pass('home page answers 200', home.status === 200, `status ${home.status}`);
  const obs = observatory(home);
  pass(
    `Observatory-equivalent grade ${obs.grade} (score ${obs.score})`,
    obs.grade === 'A+',
    obs.tests
      .filter((x) => !x.ok || x.modifier)
      .map((x) => `${x.name} ${x.modifier >= 0 ? '+' : ''}${x.modifier}`)
      .join(', '),
  );

  const asset = /\/_next\/static\/[^"]+\.js/.exec(home.body)?.[0];
  for (const [label, path] of [
    ['page', '/'],
    ['API', '/api/health'],
    ['404', '/nao-existe'],
    ['static', asset],
  ]) {
    if (!path) continue;
    const r = path === '/' ? home : await fetchRaw(new URL(path, base).href);
    const missing = NGINX_HEADERS.filter((n) => !one(r.headers, n));
    pass(`${label}: each security header exactly once`, missing.length === 0, missing.join(', '));
    pass(
      `${label}: no X-Powered-By, no server version`,
      !r.headers.has('x-powered-by') && !/\d/.test(val(r.headers, 'server')),
      val(r.headers, 'server'),
    );
  }
  const pageCsp = val(home.headers, 'content-security-policy');
  pass(
    'page CSP: nonce + strict-dynamic, no unsafe-inline/eval in script-src',
    /'nonce-[^']+'/.test(pageCsp) &&
      pageCsp.includes("'strict-dynamic'") &&
      !/script-src[^;]*'unsafe-(?:inline|eval)'/.test(pageCsp),
  );
  pass(
    'HSTS: 2 years, includeSubDomains, preload',
    val(home.headers, 'strict-transport-security') ===
      'max-age=63072000; includeSubDomains; preload',
    val(home.headers, 'strict-transport-security') || 'none',
  );
  pass(
    'pages are never cached by shared caches',
    /private/.test(val(home.headers, 'cache-control')) &&
      /no-store/.test(val(home.headers, 'cache-control')),
  );
  const ready = await fetchRaw(new URL('/api/ready', base).href);
  pass('/api/ready is not reachable from outside', ready.status === 404, `status ${ready.status}`);

  const httpUrl = `http://${base.hostname}:${httpPort}/filmes?x=1`;
  const plain = await fetchRaw(httpUrl).catch((e) => ({
    status: 0,
    headers: new Map(),
    error: e.message,
  }));
  const loc = val(plain.headers, 'location');
  pass(
    'http:// → https:// (same path)',
    plain.status === 301 && loc.startsWith('https://') && loc.endsWith('/filmes?x=1'),
    `${plain.status} ${loc}`,
  );
  const www = await fetchRaw(new URL('/series', base).href, {
    host: `www.${base.hostname}`,
    servername: `www.${base.hostname}`,
  }).catch((e) => ({ status: 0, headers: new Map(), error: e.message }));
  pass(
    'www → apex',
    www.status === 301 && val(www.headers, 'location').endsWith(`${base.hostname}/series`),
    `${www.status} ${val(www.headers, 'location')}`,
  );

  const t13 = await tlsHandshake({ minVersion: 'TLSv1.3' });
  pass('TLS 1.3 offered', t13.ok, t13.protocol ?? t13.error);
  const t12 = await tlsHandshake({ maxVersion: 'TLSv1.2', minVersion: 'TLSv1.2' });
  pass(
    'TLS 1.2 offered (forward-secret AEAD only)',
    t12.ok && /GCM|CHACHA20/.test(t12.cipher ?? ''),
    t12.cipher ?? t12.error,
  );
  // SECLEVEL=0 lets this client OFFER TLS 1.0/1.1, so a refusal really comes from the server
  const t11 = await tlsHandshake({
    maxVersion: 'TLSv1.1',
    minVersion: 'TLSv1',
    ciphers: 'DEFAULT@SECLEVEL=0',
  });
  pass('TLS 1.0/1.1 refused', !t11.ok, t11.ok ? t11.protocol : t11.error);
  const cbc = await tlsHandshake({
    maxVersion: 'TLSv1.2',
    ciphers: 'ECDHE-RSA-AES128-SHA:ECDHE-ECDSA-AES128-SHA:AES128-SHA',
  });
  pass('CBC / non-forward-secret ciphers refused', !cbc.ok, cbc.ok ? cbc.cipher : cbc.error);

  if (originIp) {
    const direct = await new Promise((resolve) => {
      const s = tls.connect(
        { host: originIp, port: 443, servername: base.hostname, rejectUnauthorized: false },
        () => {
          s.write(`GET / HTTP/1.1\r\nHost: ${base.hostname}\r\nConnection: close\r\n\r\n`);
        },
      );
      let data = '';
      s.on('data', (d) => (data += d));
      s.on('end', () => resolve(data.split('\r\n')[0] ?? ''));
      s.on('error', (e) => resolve(`error ${e.code ?? e.message}`));
      s.setTimeout(8000, () => s.destroy(new Error('timeout')));
    });
    // Firewall drop (timeout/refused) or Authenticated Origin Pulls (400 "No required SSL certificate")
    pass(
      'origin IP refuses visitors that are not Cloudflare',
      !/^HTTP\/1\.1 200/.test(String(direct)),
      String(direct),
    );
  }
} catch (err) {
  pass('site reachable', false, err instanceof Error ? err.message : String(err));
}

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ checked: results.length, failed: failed.map((f) => f.name) }));
process.exit(failed.length ? 1 : 0);
