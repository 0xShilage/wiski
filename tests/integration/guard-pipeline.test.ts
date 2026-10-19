/**
 * The guard pipeline end to end (10 §2 step 8): each guard on a test route, then the full chain
 * on a real mutation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { route } from '@/server/http/route';
import { redis } from '@/server/redis';
import { hit } from '@/server/ratelimit/sliding-window';
import { makeUser } from '../support/db';
import { call, freshIp, ORIGIN, req, signedIn } from '../support/http';

const echo = route(
  {
    methods: ['POST'],
    access: 'user',
    rateLimit: {
      name: `test-echo-${Date.now()}`,
      perIp: { limit: 3, windowMs: 60_000 },
      perUser: { limit: 100, windowMs: 60_000 },
    },
    body: z.object({ name: z.string().max(10) }).strict(),
  },
  async ({ body, user, requestId }) => ({ hello: body.name, userId: user.id, requestId }),
);

const publicGet = route(
  { methods: ['GET'], access: 'public', query: z.object({ q: z.string().max(5) }).strict() },
  async ({ query, user }) => ({ q: query.q, anonymous: user === null }),
);

const modOnly = route({ methods: ['GET'], access: 'moderator' }, async () => ({ ok: true }));
const stepUp = route({ methods: ['POST'], access: 'streamer', stepUp: true }, async () => ({
  ok: true,
}));
const captcha = route({ methods: ['POST'], access: 'public', turnstile: 'contact' }, async () => ({
  ok: true,
}));
const boom = route({ methods: ['GET'], access: 'public' }, async () => {
  throw new Error('secret internal detail: password=hunter2');
});

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

async function asUser(role: 'USER' | 'MODERATOR' | 'STREAMER' = 'USER', authTime?: Date) {
  const user = await makeUser({ role });
  return { user, ...(await signedIn(user, authTime)) };
}

afterEach(() => vi.unstubAllGlobals());

describe('happy path', () => {
  it('passes every guard and answers JSON with no-store + a request id', async () => {
    const s = await asUser();
    const res = await call(
      echo,
      req('POST', '/t', { body: { name: 'Ana' }, cookies: s.cookies, headers: s.headers }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-request-id')).toMatch(/^[\da-f-]{36}$/);
    expect(await json(res)).toMatchObject({ hello: 'Ana', userId: s.user.id });
  });

  it('keeps a well-formed upstream request id (nginx $request_id)', async () => {
    const res = await call(
      publicGet,
      req('GET', '/t?q=a', { headers: { 'x-request-id': 'a'.repeat(32) } }),
    );
    expect(res.headers.get('x-request-id')).toBe('a'.repeat(32));
    const forged = await call(
      publicGet,
      req('GET', '/t?q=a', { headers: { 'x-request-id': '<script>' } }),
    );
    expect(forged.headers.get('x-request-id')).not.toContain('<');
  });
});

describe('method, size and content type', () => {
  it('405 for a method the handler does not serve', async () => {
    const res = await call(publicGet, req('POST', '/t?q=a', { body: {} }));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });

  it('413 when the body exceeds 16 KB (declared or streamed)', async () => {
    const s = await asUser();
    const big = JSON.stringify({ name: 'x'.repeat(17 * 1024) });
    const res = await call(
      echo,
      req('POST', '/t', {
        rawBody: big,
        cookies: s.cookies,
        headers: { ...s.headers, 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(413);
  });

  it('415 for a non-JSON content type', async () => {
    const s = await asUser();
    const res = await call(
      echo,
      req('POST', '/t', {
        rawBody: 'name=Ana',
        cookies: s.cookies,
        headers: { ...s.headers, 'content-type': 'application/x-www-form-urlencoded' },
      }),
    );
    expect(res.status).toBe(415);
  });

  it('400 for malformed JSON', async () => {
    const s = await asUser();
    const res = await call(
      echo,
      req('POST', '/t', {
        rawBody: '{"name":',
        cookies: s.cookies,
        headers: { ...s.headers, 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('INVALID_JSON');
  });
});

describe('Zod .strict() validation → RFC 9457', () => {
  it('422 with field errors, never echoing the input', async () => {
    const s = await asUser();
    const payload = '<img src=x onerror=alert(1)>';
    const res = await call(
      echo,
      req('POST', '/t', { body: { name: payload }, cookies: s.cookies, headers: s.headers }),
    );
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = await json(res);
    expect(body).toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      title: 'Unprocessable Content',
    });
    expect(body.type).toBe('urn:wiskiflix:problem:validation-failed');
    expect(JSON.stringify(body)).not.toContain('onerror');
  });

  it('rejects unknown keys (mass assignment)', async () => {
    const s = await asUser();
    const res = await call(
      echo,
      req('POST', '/t', {
        body: { name: 'Ana', role: 'STREAMER' },
        cookies: s.cookies,
        headers: s.headers,
      }),
    );
    expect(res.status).toBe(422);
  });

  it('rejects unknown and repeated query parameters', async () => {
    expect((await call(publicGet, req('GET', '/t?q=a&admin=1'))).status).toBe(422);
    expect((await call(publicGet, req('GET', '/t?q=a&q=b'))).status).toBe(422);
    expect((await call(publicGet, req('GET', '/t?q=abc'))).status).toBe(200);
  });

  it('500s are generic: no stack, no internal message', async () => {
    const res = await call(boom, req('GET', '/t'));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('at ');
  });
});

describe('authentication and RBAC', () => {
  it('401 without a session, 401 with a forged cookie', async () => {
    expect((await call(echo, req('POST', '/t', { body: { name: 'a' } }))).status).toBe(401);
    expect(
      (
        await call(
          echo,
          req('POST', '/t', {
            body: { name: 'a' },
            cookies: { '__Host-wf_session': 'x'.repeat(43) },
          }),
        )
      ).status,
    ).toBe(401);
  });

  it('insufficient role → 404 (no existence leak)', async () => {
    const s = await asUser('USER');
    expect((await call(modOnly, req('GET', '/t', { cookies: s.cookies }))).status).toBe(404);
    const m = await asUser('MODERATOR');
    expect((await call(modOnly, req('GET', '/t', { cookies: m.cookies }))).status).toBe(200);
  });
});

describe('CSRF', () => {
  it('rejects a cross-site Sec-Fetch-Site', async () => {
    const s = await asUser();
    const res = await call(
      echo,
      req('POST', '/t', {
        body: { name: 'a' },
        cookies: s.cookies,
        headers: { ...s.headers, 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('CSRF_REJECTED');
  });

  it.each([
    null,
    'https://evil.example',
    'http://localhost:3000.evil.example',
    'null',
    `${ORIGIN}/`,
  ])('rejects Origin %j', async (origin) => {
    const s = await asUser();
    const res = await call(
      echo,
      req('POST', '/t', {
        body: { name: 'a' },
        cookies: s.cookies,
        headers: { ...s.headers, origin, 'sec-fetch-site': null },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('requires the session-bound token, and only the token of THIS session', async () => {
    const s = await asUser();
    const other = await asUser();
    expect(
      (await call(echo, req('POST', '/t', { body: { name: 'a' }, cookies: s.cookies }))).status,
    ).toBe(403);
    expect(
      (
        await call(
          echo,
          req('POST', '/t', { body: { name: 'a' }, cookies: s.cookies, headers: other.headers }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          echo,
          req('POST', '/t', { body: { name: 'a' }, cookies: s.cookies, headers: s.headers }),
        )
      ).status,
    ).toBe(200);
  });

  it('GETs are not CSRF-checked (and must stay side-effect free)', async () => {
    const res = await call(
      publicGet,
      req('GET', '/t?q=a', { headers: { 'sec-fetch-site': 'cross-site' } }),
    );
    expect(res.status).toBe(200);
  });
});

describe('rate limiting (Redis sliding window)', () => {
  it('429 with Retry-After once the per-IP budget is spent', async () => {
    const s = await asUser();
    const ip = freshIp();
    const send = () =>
      call(
        echo,
        req('POST', '/t', { ip, body: { name: 'a' }, cookies: s.cookies, headers: s.headers }),
      );
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(200);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another IP is unaffected.
    expect(
      (
        await call(
          echo,
          req('POST', '/t', { body: { name: 'a' }, cookies: s.cookies, headers: s.headers }),
        )
      ).status,
    ).toBe(200);
  });

  it('sliding window: old hits age out, rejected hits are not counted', async () => {
    const key = `rl:unit:${crypto.randomUUID()}`;
    const t = 1_000_000;
    expect((await hit(redis(), key, 2, 1000, t)).allowed).toBe(true);
    expect((await hit(redis(), key, 2, 1000, t + 100)).allowed).toBe(true);
    const third = await hit(redis(), key, 2, 1000, t + 200);
    expect(third).toMatchObject({ allowed: false, retryAfterMs: 800 });
    expect((await hit(redis(), key, 2, 1000, t + 1001)).allowed).toBe(true);
  });

  it('fails closed for mutations when Redis is unreachable', async () => {
    const s = await asUser();
    const spy = vi.spyOn(redis(), 'eval').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await call(
      echo,
      req('POST', '/t', { body: { name: 'a' }, cookies: s.cookies, headers: s.headers }),
    );
    expect(res.status).toBe(503);
    spy.mockRestore();
  });
});

describe('step-up', () => {
  it('requires an interactive login ≤ 10 minutes old', async () => {
    const stale = await asUser('STREAMER', new Date(Date.now() - 11 * 60_000));
    const res = await call(
      stepUp,
      req('POST', '/t', {
        cookies: stale.cookies,
        headers: { ...stale.headers, referer: `${ORIGIN}/admin/precos` },
      }),
    );
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.code).toBe('STEP_UP_REQUIRED');
    expect(body.stepUpUrl).toBe('/api/auth/google/start?stepUp=1&returnTo=%2Fadmin%2Fprecos');

    const fresh = await asUser('STREAMER', new Date());
    expect(
      (await call(stepUp, req('POST', '/t', { cookies: fresh.cookies, headers: fresh.headers })))
        .status,
    ).toBe(200);
  });
});

describe('Turnstile', () => {
  const stub = (payload: unknown) => {
    const fetchMock = vi.fn(async () => Response.json(payload));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('403 without a token (no siteverify call)', async () => {
    const fetchMock = stub({ success: true });
    expect((await call(captcha, req('POST', '/t'))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies server-side with secret, response, remoteip and idempotency_key', async () => {
    const fetchMock = stub({ success: true });
    const ip = freshIp();
    const res = await call(
      captcha,
      req('POST', '/t', { ip, headers: { 'x-turnstile-token': 'tok-123' } }),
    );
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const form = init.body as URLSearchParams;
    expect(form.get('response')).toBe('tok-123');
    expect(form.get('remoteip')).toBe(ip);
    expect(form.get('secret')).toBeTruthy();
    expect(form.get('idempotency_key')).toMatch(/^[\da-f-]{36}$/);
  });

  it('403 when Cloudflare says no', async () => {
    stub({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(
      (await call(captcha, req('POST', '/t', { headers: { 'x-turnstile-token': 'bad' } }))).status,
    ).toBe(403);
  });
});
