/**
 * CSP e2e (Phase 1 exit criterion): nonce differs per request, 0 CSP violations on every page,
 * no style="" attributes in SSR HTML, every script/style element carries the nonce.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PAGES } from './support/pages';
import { seedFor, signIn } from './support/seed';

type Violation = { directive: string; blocked: string; disposition: string; sample: string };
const reportOnly: Record<string, Violation[]> = {};

const nonceOf = (csp: string | undefined) => /'nonce-([^']+)'/.exec(csp ?? '')?.[1];

test.describe.configure({ mode: 'serial' });

test('a fresh nonce on every request, matching the HTML', async ({ request }) => {
  const nonces = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const res = await request.get('/');
    const csp = res.headers()['content-security-policy'];
    const nonce = nonceOf(csp);
    expect(nonce).toBeTruthy();
    expect(Buffer.from(nonce!, 'base64')).toHaveLength(16);
    nonces.add(nonce!);
    const html = await res.text();
    const scriptNonces = [...html.matchAll(/<script\s[^>]*?nonce="([^"]*)"/g)].map((m) => m[1]);
    expect(scriptNonces.length).toBeGreaterThan(0);
    expect(new Set(scriptNonces)).toEqual(new Set([nonce]));
  }
  expect(nonces.size).toBe(5);
});

test('a client-supplied nonce/CSP request header is ignored', async ({ request }) => {
  const res = await request.get('/', {
    headers: { 'x-nonce': 'attacker', 'content-security-policy': 'script-src *' },
  });
  expect(res.headers()['content-security-policy']).not.toContain('attacker');
  expect(await res.text()).not.toContain('nonce="attacker"');
});

for (const p of PAGES) {
  test(`${p.name}: 0 CSP violations, nonce on every script/style, no style attributes`, async ({
    page,
    context,
    request,
  }, info) => {
    let username = 'perfil_publico';
    if (p.auth || typeof p.path === 'function') {
      const seeded = await seedFor(p.auth);
      if (seeded.username) username = seeded.username;
      if (p.auth) await signIn(context, seeded.token);
    }
    const path = typeof p.path === 'function' ? p.path(username) : p.path;

    await page.addInitScript(() => {
      const w = window as unknown as { __csp: unknown[] };
      w.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        w.__csp.push({
          directive: e.effectiveDirective,
          blocked: e.blockedURI,
          disposition: e.disposition,
          sample: e.sample,
        }),
      );
    });
    const consoleCsp: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) consoleCsp.push(m.text());
    });

    const res = await page.goto(path, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(p.status ?? 200);
    await page.waitForTimeout(300); // let hydration and late resources settle

    const violations = (await page.evaluate(
      () => (window as unknown as { __csp: Violation[] }).__csp,
    )) as Violation[];
    const enforced = violations.filter((v) => v.disposition === 'enforce');
    expect(enforced, JSON.stringify(enforced, null, 2)).toEqual([]);
    expect(consoleCsp.filter((c) => !/report-only/i.test(c))).toEqual([]);
    reportOnly[`${info.project.name}:${p.name}`] = violations.filter(
      (v) => v.disposition === 'report',
    );

    // Raw SSR HTML (same cookies as the page).
    const cookieHeader = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const raw = await request.get(path, { headers: cookieHeader ? { cookie: cookieHeader } : {} });
    const html = await raw.text();
    const nonce = nonceOf(raw.headers()['content-security-policy']);
    expect(html).not.toMatch(/<[a-z][^>]*\sstyle\s*=/i);
    for (const tag of html.match(/<(?:script|style)\b[^>]*>/gi) ?? []) {
      expect(tag, tag).toContain(`nonce="${nonce}"`);
    }
  });
}

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/trusted-types-report-only.json', JSON.stringify(reportOnly, null, 2));
});
