/**
 * Authorization matrix scaffold (05 §5, Phase 1 exit criterion): every route handler × every role.
 * A meta-test fails when a route file anywhere under src/app exports a handler that has no row here, so new endpoints
 * (Phases 2–4) can't ship without an explicit access decision.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AccessLevel } from '@/server/rbac';
import { makeUser } from '../support/db';
import { call, req, signedIn } from '../support/http';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Row = {
  path: string; // route template as on disk
  method: Method;
  access: AccessLevel;
  load: () => Promise<Record<string, unknown>>;
  url?: string;
  body?: unknown;
  /** binary body (uploads) */
  rawBody?: string;
  contentType?: string;
  params?: Record<string, string>;
};

/** A well-formed id that matches nothing. */
const NO_ID = '00000000-0000-7000-8000-000000000000';

const R = (path: string, method: Method, access: AccessLevel, extra: Partial<Row> = {}): Row => ({
  path,
  method,
  access,
  load: () => import(`@/app${path}/route`) as Promise<Record<string, unknown>>,
  ...extra,
});

export const MATRIX: Row[] = [
  R('/api/health', 'GET', 'public'),
  R('/api/ready', 'GET', 'public'),
  R('/api/csp-report', 'POST', 'public', { body: { 'csp-report': {} } }),
  R('/api/auth/google/start', 'GET', 'public'),
  R('/api/auth/google/callback', 'GET', 'public'),
  R('/api/auth/logout', 'POST', 'user'),
  R('/api/v1/me', 'GET', 'user'),
  R('/api/v1/me/onboarding', 'POST', 'user', {
    body: { username: 'matrix_probe', avatarKey: 'mascote-1-ink' },
  }),
  R('/api/v1/me/profile', 'PATCH', 'user', { body: { avatarKey: 'mascote-1-ink' } }),
  R('/api/v1/me/sessions', 'GET', 'user'),
  R('/api/v1/me/sessions', 'DELETE', 'user'),
  R('/api/v1/me/sessions/[id]', 'DELETE', 'user', {
    params: { id: '00000000-0000-7000-8000-000000000000' },
  }),
  R('/api/v1/usernames/availability', 'GET', 'user', {
    url: '/api/v1/usernames/availability?u=someone',
  }),
  R('/api/v1/admin/session', 'GET', 'moderator'),

  // ── R1 ──
  // public catalog reads
  R('/api/v1/catalog/[kind]', 'GET', 'public', {
    url: '/api/v1/catalog/movies',
    params: { kind: 'movies' },
  }),
  R('/api/v1/catalog/[kind]/[slug]', 'GET', 'public', {
    url: '/api/v1/catalog/movies/nao-existe',
    params: { kind: 'movies', slug: 'nao-existe' },
  }),
  R('/api/v1/campaigns/[id]', 'GET', 'public', { params: { id: NO_ID } }),
  // passkeys (MODERATOR+; the passkey gate itself is off on these)
  R('/api/v1/me/passkeys', 'GET', 'moderator'),
  R('/api/v1/me/passkeys/registration/options', 'POST', 'moderator'),
  R('/api/v1/me/passkeys/registration', 'POST', 'moderator', { body: { response: {} } }),
  R('/api/v1/me/passkeys/authentication/options', 'POST', 'moderator'),
  R('/api/v1/me/passkeys/authentication', 'POST', 'moderator', { body: { response: {} } }),
  R('/api/v1/me/passkeys/[id]', 'DELETE', 'moderator', { params: { id: NO_ID } }),
  // dashboard (MODERATOR+, passkey)
  R('/api/v1/admin/catalog/items', 'GET', 'moderator', {
    url: '/api/v1/admin/catalog/items?kind=MOVIE',
  }),
  R('/api/v1/admin/catalog/items', 'POST', 'moderator', {
    body: { kind: 'MOVIE', title: 'Matriz', runtimeMinutes: 100 },
  }),
  R('/api/v1/admin/catalog/items/[id]', 'GET', 'moderator', { params: { id: NO_ID } }),
  R('/api/v1/admin/catalog/items/[id]', 'PATCH', 'moderator', {
    params: { id: NO_ID },
    body: { expectedVersion: 1, fields: { title: 'x' } },
  }),
  R('/api/v1/admin/catalog/items/[id]', 'DELETE', 'moderator', { params: { id: NO_ID } }),
  R('/api/v1/admin/catalog/items/[id]/publish', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { expectedVersion: 1 },
  }),
  R('/api/v1/admin/catalog/items/[id]/replace', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { replacementId: null },
  }),
  R('/api/v1/admin/catalog/items/[id]/revisions', 'GET', 'moderator', { params: { id: NO_ID } }),
  R('/api/v1/admin/catalog/items/[id]/revert', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { expectedVersion: 2, toVersion: 1 },
  }),
  R('/api/v1/admin/catalog/items/[id]/watched', 'POST', 'moderator', { params: { id: NO_ID } }),
  R('/api/v1/admin/catalog/slots', 'PUT', 'moderator', {
    body: { kind: 'MOVIE', slots: [{ id: NO_ID, slot: 1 }] },
  }),
  // development-only image server (404 in production; nginx serves /media/ there)
  R('/media/[file]', 'GET', 'public', { params: { file: `${'0'.repeat(32)}-240.webp` } }),
  R('/api/v1/admin/media', 'POST', 'moderator', {
    url: '/api/v1/admin/media?role=POSTER',
    rawBody: 'not an image',
    contentType: 'application/octet-stream',
  }),
  // money actions (STREAMER, passkey + step-up)
  R('/api/v1/admin/campaigns/[id]/open', 'POST', 'streamer', {
    params: { id: NO_ID },
    body: { expectedVersion: 1 },
  }),
  R('/api/v1/admin/campaigns/[id]/extend', 'POST', 'streamer', {
    params: { id: NO_ID },
    body: { days: 7 },
  }),
  R('/api/v1/admin/campaigns/[id]/goal', 'POST', 'streamer', {
    params: { id: NO_ID },
    body: { goalCents: 10000 },
  }),
];

const ROLES = ['anonymous', 'USER', 'MODERATOR', 'STREAMER'] as const;
const RANK = { anonymous: -1, USER: 0, MODERATOR: 1, STREAMER: 2 } as const;
const NEED = { public: -1, user: 0, moderator: 1, streamer: 2 } as const;

function expected(role: (typeof ROLES)[number], access: AccessLevel): 'allow' | 401 | 404 {
  if (RANK[role] >= NEED[access]) return 'allow';
  return role === 'anonymous' ? 401 : 404;
}

describe('authz matrix', () => {
  for (const row of MATRIX) {
    for (const role of ROLES) {
      const want = expected(role, row.access);
      it(`${row.method} ${row.path} as ${role} → ${want}`, async () => {
        const mod = await row.load();
        const handler = mod[row.method] as Parameters<typeof call>[0];
        expect(handler, 'handler exported').toBeTypeOf('function');
        const auth =
          role === 'anonymous'
            ? { cookies: {}, headers: {} }
            : await signedIn(
                await makeUser({
                  role,
                  username: role === 'USER' && row.path.endsWith('onboarding') ? null : undefined,
                }),
              );
        const res = await call(
          handler,
          req(row.method, row.url ?? row.path.replace('[id]', row.params?.id ?? ''), {
            cookies: auth.cookies,
            headers: {
              ...auth.headers,
              ...(row.contentType ? { 'content-type': row.contentType } : {}),
              ...(row.rawBody !== undefined
                ? { 'content-length': String(row.rawBody.length) }
                : {}),
            },
            ...(row.body !== undefined ? { body: row.body } : {}),
            ...(row.rawBody !== undefined ? { rawBody: row.rawBody } : {}),
          }),
          row.params,
        );
        if (want === 'allow') {
          expect([401, 403, 405]).not.toContain(res.status);
          // A 404 is only acceptable where the resource itself doesn't exist (IDOR-safe lookups).
          if (res.status === 404) expect(row.params).toBeDefined();
        } else {
          expect(res.status).toBe(want);
        }
      });
    }
  }
});

describe('authz matrix completeness', () => {
  it('every exported route handler has a matrix row', () => {
    const appDir = join(import.meta.dirname, '../../src/app');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === 'route.ts') files.push(p);
      }
    };
    walk(appDir);
    const exported = files.flatMap((file) => {
      const path =
        '/' +
        relative(appDir, file)
          .replace(/\/route\.ts$/, '')
          .split('\\')
          .join('/');
      const src = readFileSync(file, 'utf8');
      return [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map(
        (m) => `${m[1]} ${path}`,
      );
    });
    const covered = new Set(MATRIX.map((r) => `${r.method} ${r.path}`));
    expect(exported.filter((e) => !covered.has(e))).toEqual([]);
    expect([...covered].filter((c) => !exported.includes(c))).toEqual([]);
  });
});
