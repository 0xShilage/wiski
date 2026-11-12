/**
 * Header ownership (05 §7): each security header present EXACTLY ONCE on a page, an API route,
 * static assets and a 404 — nginx's headers come from docker/nginx/snippets/security-headers.conf.
 * R1: Permissions-Policy for the trailer player, /media/ files (media.conf) and the upload
 * location (upload.conf).
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import tls from 'node:tls';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { stack } from './support/seed';
import { HTTP_PORT } from './support/ports';

const NGINX_OWNED = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
} as const;

async function headerCounts(request: APIRequestContext, path: string) {
  const res = await request.get(path, { maxRedirects: 0 });
  const counts = new Map<string, string[]>();
  for (const { name, value } of res.headersArray()) {
    const k = name.toLowerCase();
    counts.set(k, [...(counts.get(k) ?? []), value]);
  }
  return { res, counts };
}

test('static asset path discovery', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toMatch(/\/_next\/static\/[^"]+\.js/);
});

for (const [label, path, kind] of [
  ['page', '/', 'page'],
  ['404 page', '/nao-existe', 'page'],
  ['API', '/api/health', 'api'],
  ['brand asset', '/brand/logo-wiski-lilac.svg', 'static'],
  ['profile picture', '/avatars/perfil-01-128.webp', 'static'],
  ['favicon', '/favicon.ico', 'static-app'],
] as const) {
  test(`${label} (${path}): every security header exactly once`, async ({ request }) => {
    const { res, counts } = await headerCounts(request, path);
    for (const [name, value] of Object.entries(NGINX_OWNED)) {
      expect(counts.get(name), name).toEqual([value]);
    }
    expect(counts.get('permissions-policy')).toHaveLength(1);
    expect(counts.get('permissions-policy')![0]).toContain('camera=()');
    expect(counts.has('x-powered-by')).toBe(false);
    expect(counts.get('server') ?? ['nginx']).toEqual(['nginx']); // no version
    if (kind === 'page') {
      expect(counts.get('content-security-policy')).toHaveLength(1);
      expect(counts.get('content-security-policy-report-only')).toHaveLength(1);
      expect(counts.get('reporting-endpoints')).toHaveLength(1);
      expect(counts.get('cache-control')).toHaveLength(1);
      expect(counts.get('cache-control')![0]).toMatch(/private/);
      expect(counts.get('cache-control')![0]).toMatch(/no-store/);
    }
    if (kind === 'api') {
      expect(counts.get('content-security-policy')).toEqual([
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      ]);
      expect(counts.get('cache-control')).toEqual(['private, no-store']);
    }
    if (kind === 'static') {
      expect(counts.get('cache-control')).toHaveLength(1);
      expect(res.status()).toBe(200);
    }
  });
}

test('hashed build assets are immutable (cache header once)', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const js = /\/_next\/static\/[^"]+\.js/.exec(html)![0];
  const { counts } = await headerCounts(request, js);
  expect(counts.get('cache-control')).toEqual(['public, max-age=31536000, immutable']);
  expect(counts.get('x-content-type-options')).toEqual(['nosniff']);
});

test('/api/ready is not reachable from outside the Docker network', async ({ request }) => {
  expect((await request.get('/api/ready')).status()).toBe(404);
});

test('www → apex and plain HTTP → https, keeping the path (production site template)', async () => {
  const get = (url: string, host: string, tls: boolean) =>
    new Promise<{ status: number; location: string | undefined }>((resolve, reject) => {
      const u = new URL(url);
      const mod = tls ? httpsRequest : httpRequest;
      const r = mod(
        {
          hostname: '127.0.0.1',
          port: u.port,
          path: u.pathname + u.search,
          method: 'GET',
          headers: { host },
          servername: host,
          rejectUnauthorized: false,
        },
        (res) => {
          resolve({ status: res.statusCode ?? 0, location: res.headers.location });
          res.resume();
        },
      );
      r.on('error', reject);
      r.end();
    });
  const https = new URL(stack().origin);
  const www = await get(`https://127.0.0.1:${https.port}/filmes?x=1`, 'www.localhost', true);
  expect(www).toEqual({ status: 301, location: 'https://localhost/filmes?x=1' });
  const plain = await get(`http://127.0.0.1:${HTTP_PORT}/series`, 'localhost', false);
  expect(plain).toEqual({ status: 301, location: 'https://localhost/series' });
});

test('TLS: unknown server names get no certificate; TLS 1.1 is refused', async () => {
  const port = Number(new URL(stack().origin).port);
  const handshake = (servername: string, opts: tls.ConnectionOptions = {}) =>
    new Promise<string>((resolve) => {
      const s = tls.connect(
        { host: '127.0.0.1', port, servername, rejectUnauthorized: false, ...opts },
        () => {
          resolve(`ok ${s.getProtocol()}`);
          s.end();
        },
      );
      s.on('error', (e) => resolve(`error ${(e as NodeJS.ErrnoException).code ?? e.message}`));
    });
  expect(await handshake('localhost')).toMatch(/^ok TLSv1\.[23]$/);
  expect(await handshake('evil.example')).toMatch(/^error/);
  expect(await handshake('localhost', { maxVersion: 'TLSv1.1', minVersion: 'TLSv1' })).toMatch(
    /^error/,
  );
});

test('Permissions-Policy delegates the player features to youtube-nocookie (and Twitch) only', async ({
  request,
}) => {
  const { counts } = await headerCounts(request, '/');
  const pp = counts.get('permissions-policy')![0]!;
  for (const feature of ['encrypted-media', 'picture-in-picture']) {
    expect(pp).toContain(`${feature}=(self "https://www.youtube-nocookie.com")`);
  }
  for (const feature of ['autoplay', 'fullscreen']) {
    expect(pp).toContain(
      `${feature}=(self "https://www.youtube-nocookie.com" "https://player.twitch.tv")`,
    );
  }
  expect(pp).not.toMatch(/youtube\.com"/);
  expect(pp).not.toContain('*');
});

test('/media/ files: served by nginx with immutable caching and each header once', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  const path = /\/media\/[0-9a-f]{32}-\d{2,4}\.(?:avif|webp)/.exec(html)?.[0];
  expect(path, 'the seeded home page references processed images').toBeTruthy();
  const { res, counts } = await headerCounts(request, path!);
  expect(res.status()).toBe(200);
  for (const [name, value] of Object.entries(NGINX_OWNED)) {
    expect(counts.get(name), name).toEqual([value]);
  }
  expect(counts.get('cache-control')).toEqual(['public, max-age=31536000, immutable']);
  expect(counts.get('content-security-policy')).toEqual([
    "default-src 'none'; frame-ancestors 'none'; sandbox",
  ]);
  expect(counts.get('content-type')).toEqual([
    path!.endsWith('.avif') ? 'image/avif' : 'image/webp',
  ]);
  expect(counts.has('set-cookie')).toBe(false);
  expect((await request.head(path!)).status()).toBe(200);
  expect((await request.post(path!, { data: 'x' })).status()).toBe(403);
});

for (const bad of [
  '/media/',
  '/media/x.webp',
  `/media/${'a'.repeat(32)}-480.png`,
  `/media/${'A'.repeat(32)}-480.webp`,
  `/media/${'a'.repeat(31)}-480.webp`,
  `/media/${'a'.repeat(32)}-480.webp`, // well-formed but absent
  `/media/${'a'.repeat(32)}-480.webp.svg`,
  '/media/%2e%2e/nginx.conf',
  '/media/..%2fnginx.conf',
]) {
  test(`/media/ refuses ${bad}`, async ({ request }) => {
    const { res, counts } = await headerCounts(request, bad);
    expect(res.status()).toBe(404);
    expect(counts.get('x-content-type-options')).toEqual(['nosniff']);
    expect(await res.text()).not.toContain('worker_processes');
  });
}

test('upload location: only POST, nginx caps the body at 11 MB', async ({ request }, info) => {
  // Once per run: these requests count against nginx's 2 r/min upload zone. Other specs upload
  // too (posters), so a 429 here only means the zone is busy: wait for it (2026-11-09: this
  // failed two CI runs in a row on a 429).
  test.skip(info.project.name !== 'desktop-1280', 'runs once');
  test.setTimeout(180_000);
  await expect
    .poll(async () => (await request.get('/api/v1/admin/media')).status(), {
      timeout: 75_000,
      intervals: [10_000],
    })
    .toBe(403);
  await expect.poll(announce12Mb, { timeout: 75_000, intervals: [10_000] }).toBe(413);
});

/** Announce 12 MB and send nothing: nginx answers 413 from the headers alone. */
function announce12Mb(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const url = new URL('/api/v1/admin/media?role=POSTER', stack().origin);
    const req = httpsRequest(
      url,
      {
        method: 'POST',
        rejectUnauthorized: false,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(12 * 1024 * 1024) },
      },
      (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
        req.destroy();
      },
    );
    req.on('error', reject);
    req.flushHeaders();
  });
}

test('pentest 2026-11-11: pages are read-only at the edge, and security.txt is served', async ({
  request,
}) => {
  for (const method of ['PUT', 'DELETE', 'PATCH', 'POST'] as const) {
    const res = await request.fetch('/filmes', { method, maxRedirects: 0 });
    expect(res.status(), method).toBe(403);
    expect(res.headers()['x-frame-options']).toBe('DENY');
  }
  // the API keeps its methods and its own answers (anonymous: 401)
  expect((await request.fetch('/api/v1/me/profile', { method: 'PATCH', data: {} })).status()).toBe(
    401,
  );
  expect((await request.get('/api/v1/live')).status()).toBe(200);
  const txt = await request.get('/.well-known/security.txt');
  expect(txt.status()).toBe(200);
  expect(txt.headers()['content-type']).toMatch(/^text\/plain/);
  expect(await txt.text()).toMatch(/^Contact: https:\/\/wiski\.fun\/contato$/m);
});
