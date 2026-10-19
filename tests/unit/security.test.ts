import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/server/env';
import { clientIp, ipBucket, ipKey } from '@/server/security/client-ip';
import { csrfTokenFor, isSameOriginRequest, isValidCsrfToken } from '@/server/security/csrf';
import { randomToken, safeEqual, seal, unseal } from '@/server/security/crypto';
import { safeReturnTo } from '@/server/security/return-to';
import { testEnv } from '../support/env';

beforeEach(() => {
  for (const [k, v] of Object.entries(testEnv())) vi.stubEnv(k, v);
  resetEnvCache();
});

const KEY_A = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const KEY_B = 'HxwdHh8YGRobHBEQEhMUFRYXCAkKCwwNDg8AAQIDBAU';

describe('sealed cookies (AES-256-GCM)', () => {
  it('round-trips and is opaque', () => {
    const sealed = seal({ s: 'state' }, { current: KEY_A }, 'p', 60_000);
    expect(sealed).not.toContain('state');
    expect(unseal(sealed, { current: KEY_A }, 'p')).toEqual({ s: 'state' });
  });

  it('rejects tampering, wrong purpose, wrong key and expiry', () => {
    const sealed = seal({ s: 1 }, { current: KEY_A }, 'p', 60_000);
    const flipped = sealed.slice(0, -3) + (sealed.at(-3) === 'A' ? 'B' : 'A') + sealed.slice(-2);
    expect(unseal(flipped, { current: KEY_A }, 'p')).toBeNull();
    expect(unseal(sealed, { current: KEY_A }, 'other-purpose')).toBeNull();
    expect(unseal(sealed, { current: KEY_B }, 'p')).toBeNull();
    expect(unseal(seal({ s: 1 }, { current: KEY_A }, 'p', -1), { current: KEY_A }, 'p')).toBeNull();
    expect(unseal('v1.zz.garbage', { current: KEY_A }, 'p')).toBeNull();
    expect(unseal('x'.repeat(5000), { current: KEY_A }, 'p')).toBeNull();
  });

  it('supports key rotation (previous key still opens old values)', () => {
    const old = seal({ s: 1 }, { current: KEY_A }, 'p', 60_000);
    expect(unseal(old, { current: KEY_B, previous: KEY_A }, 'p')).toEqual({ s: 1 });
  });
});

describe('tokens & comparison', () => {
  it('randomToken is 256-bit base64url and unique', () => {
    const a = randomToken();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(new Set(Array.from({ length: 100 }, () => randomToken())).size).toBe(100);
  });
  it('safeEqual handles unequal lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('CSRF', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it('requires exact canonical Origin and same-origin fetch metadata', () => {
    expect(
      isSameOriginRequest(h({ origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' })),
    ).toBe(true);
    expect(isSameOriginRequest(h({ origin: 'http://localhost:3000' }))).toBe(true); // older browsers
    expect(
      isSameOriginRequest(h({ origin: 'http://localhost:3000', 'sec-fetch-site': 'same-site' })),
    ).toBe(false);
    expect(isSameOriginRequest(h({ origin: 'http://localhost:3000.evil.com' }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: 'http://LOCALHOST:3000' }))).toBe(false);
    expect(isSameOriginRequest(h({}))).toBe(false);
  });
  it('binds tokens to the session and scope', () => {
    const t = csrfTokenFor('session-1');
    expect(isValidCsrfToken(t, 'session-1')).toBe(true);
    expect(isValidCsrfToken(t, 'session-2')).toBe(false);
    expect(isValidCsrfToken(t, 'session-1', 'order')).toBe(false);
    expect(isValidCsrfToken(null, 'session-1')).toBe(false);
    expect(isValidCsrfToken('x'.repeat(100), 'session-1')).toBe(false);
  });
});

describe('returnTo (open redirect)', () => {
  it.each([
    ['/perfil', '/perfil'],
    ['/u/ana?aba=avaliacoes', '/u/ana?aba=avaliacoes'],
    ['/perfil#x', '/perfil'],
    [null, '/perfil'],
    ['', '/perfil'],
    ['https://evil.example', '/perfil'],
    ['//evil.example', '/perfil'],
    ['/\\evil.example', '/perfil'],
    ['\\\\evil.example', '/perfil'],
    ['/%2f%2fevil.example', '/perfil'],
    ['/%5Cevil.example', '/perfil'],
    [['javascript', 'alert(1)'].join(':'), '/perfil'],
    ['/perfil\r\nLocation: x', '/perfil'],
    ['/ perfil', '/perfil'],
    ['/api/auth/logout', '/perfil'],
    ['/_next/static/x.js', '/perfil'],
    ['/a/../../series', '/series'],
    ['/' + 'a'.repeat(600), '/perfil'],
  ])('%j → %j', (input, out) => {
    expect(safeReturnTo(input)).toBe(out);
  });
});

describe('client IP', () => {
  it('trusts only the configured header and valid IPs', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers({ 'x-real-ip': 'not-an-ip' }))).toBeNull();
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9' }))).toBeNull();
  });
  it('buckets IPv6 by /64 and hashes keys', () => {
    expect(ipBucket('2001:db8:1:2:aaaa::1')).toBe('2001:0db8:0001:0002::/64');
    expect(ipBucket('2001:db8:1:2::ffff')).toBe('2001:0db8:0001:0002::/64');
    expect(ipKey('2001:db8:1:2::1')).toBe(ipKey('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(ipKey('203.0.113.9')).not.toContain('203');
    expect(ipKey(null)).toBe('unknown');
  });
});
