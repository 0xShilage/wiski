import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv, TURNSTILE_TEST_SECRET_KEY } from '@/server/env';

const key = (c: string) => c.repeat(43);

const valid = {
  NODE_ENV: 'development',
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://wf_app:pw@localhost:5432/wiskiflix',
  REDIS_URL: 'redis://localhost:6379',
  CSRF_SECRET: key('a'),
  COOKIE_SEAL_KEY: key('b'),
  IP_HASH_SECRET: key('c'),
};

const production = {
  ...valid,
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://wiski.fun',
  GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-0123456789abcdef',
  TURNSTILE_SITE_KEY: '0x4AAAAAAAreal-site-key',
  TURNSTILE_SECRET_KEY: '0x4AAAAAAAreal-secret-key',
  MEDIA_DIR: '/var/lib/wiski/media',
};

function problems(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return (error as EnvError).problems;
  }
}

describe('env validation (refuses to boot on missing/invalid vars)', () => {
  it('accepts a minimal development environment and applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.CLIENT_IP_HEADER).toBe('x-real-ip');
    expect(env.TURNSTILE_SECRET_KEY).toBe(TURNSTILE_TEST_SECRET_KEY);
    expect(env.MEDIA_DIR).toBeUndefined();
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('accepts a complete production environment', () => {
    expect(problems(production)).toEqual([]);
  });

  it.each([
    'APP_ORIGIN',
    'DATABASE_URL',
    'REDIS_URL',
    'CSRF_SECRET',
    'COOKIE_SEAL_KEY',
    'IP_HASH_SECRET',
  ])('rejects a missing %s', (name) => {
    const { [name as keyof typeof valid]: _omit, ...rest } = valid;
    expect(problems(rest).some((p) => p.startsWith(`${name}:`))).toBe(true);
  });

  it('treats empty values as missing', () => {
    expect(problems({ ...valid, CSRF_SECRET: '' }).some((p) => p.startsWith('CSRF_SECRET:'))).toBe(
      true,
    );
  });

  it('never echoes secret values in error messages', () => {
    const secret = 'too-short-but-very-secret';
    const msgs = problems({ ...valid, CSRF_SECRET: secret }).join('\n');
    expect(msgs).toContain('CSRF_SECRET');
    expect(msgs).not.toContain(secret);
  });

  it('rejects weak or malformed keys', () => {
    expect(problems({ ...valid, COOKIE_SEAL_KEY: key('b') + 'x' })).not.toEqual([]); // not 32 bytes
    expect(problems({ ...valid, CSRF_SECRET: 'short' })).not.toEqual([]);
  });

  it('requires distinct secrets', () => {
    expect(problems({ ...valid, IP_HASH_SECRET: valid.CSRF_SECRET })).toContainEqual(
      expect.stringContaining('must all differ'),
    );
  });

  it('rejects .env.example placeholders', () => {
    expect(
      problems({ ...valid, DATABASE_URL: 'postgresql://wf_app:CHANGE_ME@localhost/db' }),
    ).toContainEqual(expect.stringContaining('placeholder'));
  });

  it('requires an origin without path and https outside localhost', () => {
    expect(problems({ ...valid, APP_ORIGIN: 'http://localhost:3000/' })).not.toEqual([]);
    expect(problems({ ...valid, APP_ORIGIN: 'http://wiski.fun' })).not.toEqual([]);
    expect(problems({ ...valid, APP_ORIGIN: ['javascript', 'alert(1)'].join(':') })).not.toEqual(
      [],
    );
    expect(problems({ ...production, APP_ORIGIN: 'http://localhost:3000' })).not.toEqual([]);
  });

  it('refuses Cloudflare Turnstile test keys in production', () => {
    const { TURNSTILE_SITE_KEY: _a, TURNSTILE_SECRET_KEY: _b, ...rest } = production;
    expect(problems(rest)).toContainEqual(expect.stringContaining('test keys'));
  });

  it('requires Google credentials in production, and both or neither elsewhere', () => {
    const { GOOGLE_CLIENT_ID: _a, GOOGLE_CLIENT_SECRET: _b, ...rest } = production;
    expect(problems(rest)).toContainEqual(expect.stringContaining('GOOGLE_CLIENT_ID'));
    expect(problems({ ...valid, GOOGLE_CLIENT_ID: production.GOOGLE_CLIENT_ID })).not.toEqual([]);
  });

  it('only allows a non-https OIDC issuer in tests', () => {
    expect(problems({ ...valid, GOOGLE_ISSUER: 'http://127.0.0.1:9999' })).not.toEqual([]);
    expect(
      problems({ ...valid, NODE_ENV: 'test', GOOGLE_ISSUER: 'http://127.0.0.1:9999' }),
    ).toEqual([]);
  });

  it('requires an absolute MEDIA_DIR in production (11 §5) and has no TMDB settings any more', () => {
    const { MEDIA_DIR: _m, ...rest } = production;
    expect(problems(rest)).toContainEqual(expect.stringContaining('MEDIA_DIR'));
    expect(problems({ ...production, MEDIA_DIR: 'media' })).toContainEqual(
      expect.stringContaining('absolute'),
    );
    expect(parseEnv({ ...valid, TMDB_API_KEY: 'k'.repeat(32) })).not.toHaveProperty('TMDB_API_KEY');
  });

  it('detects a Mercado Pago token that belongs to another account (test vs production ids)', () => {
    const token = 'APP_USR-1111111111111111-100200-0123456789abcdef0123456789abcdef-2222222222';
    expect(
      problems({ ...valid, MP_ACCESS_TOKEN: token, MP_COLLECTOR_ID: '3333333333' }),
    ).toContainEqual(expect.stringContaining('MP_COLLECTOR_ID'));
    expect(problems({ ...valid, MP_ACCESS_TOKEN: token, MP_COLLECTOR_ID: '2222222222' })).toEqual(
      [],
    );
  });
});
