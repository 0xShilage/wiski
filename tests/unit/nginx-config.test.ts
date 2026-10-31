/**
 * The production nginx configuration (docker/nginx) as the container will see it — main file,
 * site template rendered with production values, every snippet including Authenticated Origin
 * Pulls and Cloudflare's real-IP list — passes `nginx -t`. The browser tests run the same site
 * template behind the real app (tests/e2e/support/stack.ts).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderSiteTemplate } from '../support/nginx-template';

const ROOT = join(import.meta.dirname, '../..');
const hasNginx = (() => {
  try {
    execFileSync('nginx', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function selfSigned(dir: string, name: string) {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-days',
      '1',
      '-subj',
      `/CN=${name}`,
      '-keyout',
      join(dir, `${name}.key`),
      '-out',
      join(dir, `${name}.pem`),
    ],
    { stdio: 'ignore' },
  );
}

type Prepared = { root: string; etc: string };

/** The production files under a temp prefix: main config, rendered site, every real snippet. */
function prepare(upstreamPort: number): Prepared {
  const root = mkdtempSync(join(tmpdir(), 'wf-nginx-'));
  const etc = join(root, 'etc');
  mkdirSync(etc);
  for (const d of ['snippets', 'conf.d', 'tls', 'cache', 'run', 'media']) mkdirSync(join(etc, d));
  cpSync(join(ROOT, 'docker/nginx/snippets'), join(etc, 'snippets'), { recursive: true });
  // the snippet points at the container path of Cloudflare's (public) origin-pull CA; a test CA
  // stands in for it, so the client-certificate check itself runs for real
  const pull = join(etc, 'snippets/origin-pull.conf');
  selfSigned(join(etc, 'tls'), 'origin-pull-ca');
  writeFileSync(
    pull,
    readFileSync(pull, 'utf8').replace(
      '/etc/nginx/tls/origin-pull-ca.pem',
      join(etc, 'tls/origin-pull-ca.pem'),
    ),
  );
  selfSigned(join(etc, 'tls'), 'origin');
  const site = renderSiteTemplate({
    WF_SERVER_NAME: 'wiski.fun',
    WF_UPSTREAM: 'web:3000',
    WF_LISTEN_HTTPS: '127.0.0.1:18443',
    WF_LISTEN_HTTP: '127.0.0.1:18080',
    WF_CERT: join(etc, 'tls/origin.pem'),
    WF_CERT_KEY: join(etc, 'tls/origin.key'),
    WF_MEDIA_ROOT: join(etc, 'media'),
    WF_SNIPPETS: join(etc, 'snippets'),
  });
  expect(site).not.toMatch(/\$\{/);
  // `web` only resolves inside the compose network
  writeFileSync(
    join(etc, 'conf.d/site.conf'),
    site.replace('server web:3000;', `server 127.0.0.1:${upstreamPort};`),
  );
  const main = readFileSync(join(ROOT, 'docker/nginx/nginx.conf'), 'utf8')
    .replace(/^user nginx;$/m, '')
    .replace('/var/run/nginx/nginx.pid', join(etc, 'run/nginx.pid'))
    .replaceAll('/var/cache/nginx', join(etc, 'cache'))
    .replaceAll('/var/log/nginx', join(etc, 'run'))
    .replace('/etc/nginx/conf.d/*.conf', join(etc, 'conf.d/*.conf'));
  writeFileSync(join(etc, 'nginx.conf'), main);
  return { root, etc };
}

function get(
  path: string,
  o: { cert?: { key: Buffer; cert: Buffer }; headers?: Record<string, string> } = {},
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: '127.0.0.1',
        port: 18443,
        path,
        servername: 'wiski.fun',
        headers: { host: 'wiski.fun', ...o.headers },
        rejectUnauthorized: false,
        ...(o.cert ?? {}),
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += String(d)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe.skipIf(!hasNginx)('production nginx config', () => {
  it('renders every WF_* variable and passes nginx -t with the real snippets', () => {
    const { root, etc } = prepare(3000);
    const out = execFileSync('nginx', ['-t', '-c', join(etc, 'nginx.conf'), '-p', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    expect(out).toBe('');
    expect(existsSync(join(etc, 'conf.d/site.conf'))).toBe(true);
  });

  it('running: no Cloudflare client certificate → refused; with one → proxied; X-Real-IP not spoofable', async () => {
    // upstream: echoes what nginx forwards
    const upstream = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          realIp: req.headers['x-real-ip'],
          xff: req.headers['x-forwarded-for'] ?? null,
        }),
      );
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
    const port = (upstream.address() as AddressInfo).port;
    const { root, etc } = prepare(port);
    // a client certificate signed by the (test) origin-pull CA — what Cloudflare presents
    const tlsDir = join(etc, 'tls');
    execFileSync(
      'openssl',
      [
        'req',
        '-new',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-subj',
        '/CN=cloudflare',
        '-keyout',
        join(tlsDir, 'client.key'),
        '-out',
        join(tlsDir, 'client.csr'),
      ],
      { stdio: 'ignore' },
    );
    execFileSync(
      'openssl',
      [
        'x509',
        '-req',
        '-in',
        join(tlsDir, 'client.csr'),
        '-CA',
        join(tlsDir, 'origin-pull-ca.pem'),
        '-CAkey',
        join(tlsDir, 'origin-pull-ca.key'),
        '-CAcreateserial',
        '-days',
        '1',
        '-out',
        join(tlsDir, 'client.pem'),
      ],
      { stdio: 'ignore' },
    );
    const nginx = spawn('nginx', ['-c', join(etc, 'nginx.conf'), '-p', root, '-g', 'daemon off;'], {
      stdio: 'ignore',
    });
    try {
      for (let i = 0; i < 50; i++) {
        if (
          await get('/').then(
            () => true,
            () => false,
          )
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const anonymous = await get('/');
      expect(anonymous.status).toBe(400);
      expect(anonymous.body).toContain('No required SSL certificate was sent');

      const cert = {
        key: readFileSync(join(tlsDir, 'client.key')),
        cert: readFileSync(join(tlsDir, 'client.pem')),
      };
      const ok = await get('/', {
        cert,
        headers: {
          'cf-connecting-ip': '198.51.100.9',
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '203.0.113.2',
        },
      });
      expect(ok.status).toBe(200);
      // 127.0.0.1 is not a Cloudflare range: CF-Connecting-IP and client-sent headers are ignored
      expect(JSON.parse(ok.body)).toEqual({ realIp: '127.0.0.1', xff: null });
      expect((await get('/api/ready', { cert })).status).toBe(404);
    } finally {
      nginx.kill('SIGTERM');
      upstream.close();
    }
  });

  it('keeps the guard rails: AOP on, real IP from Cloudflare only, TLS ≥ 1.2, no gzip on pages', () => {
    const tpl = readFileSync(join(ROOT, 'docker/nginx/templates/wiskiflix.conf.template'), 'utf8');
    const tls = readFileSync(join(ROOT, 'docker/nginx/snippets/tls.conf'), 'utf8');
    const pull = readFileSync(join(ROOT, 'docker/nginx/snippets/origin-pull.conf'), 'utf8');
    const realIp = readFileSync(
      join(ROOT, 'docker/nginx/snippets/cloudflare-real-ip.conf'),
      'utf8',
    );
    expect(pull).toMatch(/^ssl_verify_client on;$/m);
    // every TLS server includes origin-pull and the TLS policy
    const tlsServers = tpl.split('server {').filter((b) => /ssl_certificate /.test(b));
    expect(tlsServers.length).toBe(2);
    for (const b of tlsServers) {
      expect(b).toContain('origin-pull.conf');
      expect(b).toContain('tls.conf');
    }
    expect(tls).toMatch(/^ssl_protocols TLSv1\.2 TLSv1\.3;$/m);
    expect(tls).not.toMatch(/RSA-AES\d+-SHA[;:]|CBC|RC4|3DES/);
    expect(realIp).toMatch(/^real_ip_header CF-Connecting-IP;$/m);
    expect(realIp).not.toMatch(/0\.0\.0\.0\/0|::\/0/);
    // gzip only inside the static-assets location (BREACH: pages carry a CSRF token)
    expect(tpl.split('gzip on;')).toHaveLength(2);
    const at = tpl.indexOf('gzip on;');
    expect(tpl.lastIndexOf('location ', at)).toBe(tpl.lastIndexOf('location /_next/static/', at));
    expect(tpl).toMatch(/location = \/api\/ready \{ return 404; \}/);
  });
});
