/**
 * Authorization matrix scaffold (05 §5, Phase 1 exit criterion): every route handler × every role.
 * A meta-test fails when a route file anywhere under src/app exports a handler that has no row here, so new endpoints
 * (Phases 2–4) can't ship without an explicit access decision.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  headers?: Record<string, string>;
  /** statuses that still count as "allowed" for this row (the webhook authenticates by HMAC, not
   *  by role — its signature checks live in tests/integration/webhook.test.ts) */
  alsoAllowed?: number[];
};

/** A well-formed id that matches nothing. */
const NO_ID = '00000000-0000-7000-8000-000000000000';
const NO_CODE = 'WF-000000';
const LEGAL = { terms: 'x', privacy: 'x', refund: 'x' };
const SAMPLE_MOVIE_ORDER = {
  movieId: NO_ID,
  queueJumpTier: null,
  expectedTotalCents: 2000,
  contactEmail: 'matriz@example.com',
  legal: LEGAL,
};
const VERSION0 = { expectedVersion: 0 };
const SAMPLE_CONTRIBUTION = { amountCents: 500, contactEmail: 'matriz@example.com', legal: LEGAL };

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
    body: { username: 'matrix_probe', avatarKey: 'perfil-01' },
  }),
  R('/api/v1/me/profile', 'PATCH', 'user', { body: { avatarKey: 'perfil-01' } }),
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
  // authenticator app (2026-10-31)
  R('/api/v1/me/totp/setup', 'POST', 'moderator'),
  R('/api/v1/me/totp/enable', 'POST', 'moderator', { body: { code: '123456' } }),
  R('/api/v1/me/totp/verify', 'POST', 'moderator', { body: { code: '123456' } }),
  R('/api/v1/me/totp/recovery-codes', 'POST', 'moderator'),
  R('/api/v1/me/totp', 'DELETE', 'moderator'),
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
  R('/api/v1/admin/catalog/items/[id]/unwatched', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: VERSION0,
  }),
  R('/api/v1/admin/catalog/items/[id]/watched-offstream', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { expectedVersion: 0, watchedOn: null },
  }),
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
  R('/api/v1/admin/campaigns/[id]/open', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { expectedVersion: 1 },
  }),
  R('/api/v1/admin/campaigns/[id]/extend', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { days: 7 },
  }),
  R('/api/v1/admin/campaigns/[id]/goal', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { goalCents: 10000 },
  }),

  // ── Phase 2 (payments) ──
  R('/api/v1/sponsorships/quote', 'POST', 'public', {
    body: { movieId: NO_ID, queueJumpTier: null },
    params: {},
  }),
  R('/api/v1/sponsorships', 'POST', 'public', {
    body: SAMPLE_MOVIE_ORDER,
    headers: { 'idempotency-key': NO_ID, 'x-turnstile-token': 'tok' },
  }),
  R('/api/v1/campaigns/[id]/contributions', 'POST', 'public', {
    params: { id: NO_ID },
    body: SAMPLE_CONTRIBUTION,
    headers: { 'idempotency-key': NO_ID, 'x-turnstile-token': 'tok' },
  }),
  R('/api/v1/campaigns/[id]/events', 'GET', 'public', { params: { id: NO_ID } }),
  R('/api/v1/orders/[code]', 'GET', 'public', {
    params: { code: NO_CODE },
    url: `/api/v1/orders/${NO_CODE}`,
  }),
  R('/api/v1/orders/[code]/access', 'POST', 'public', {
    params: { code: NO_CODE },
    url: `/api/v1/orders/${NO_CODE}/access`,
    body: { token: 'A'.repeat(43) },
  }),
  R('/api/v1/orders/[code]/events', 'GET', 'public', {
    params: { code: NO_CODE },
    url: `/api/v1/orders/${NO_CODE}/events`,
  }),
  R('/api/v1/orders/[code]/cancel', 'POST', 'public', {
    params: { code: NO_CODE },
    url: `/api/v1/orders/${NO_CODE}/cancel`,
  }),
  R('/api/v1/orders/[code]/claim', 'POST', 'user', {
    params: { code: NO_CODE },
    url: `/api/v1/orders/${NO_CODE}/claim`,
  }),
  R('/api/v1/me/orders', 'GET', 'user'),
  R('/api/v1/legal/current', 'GET', 'public'),
  R('/api/webhooks/mercadopago', 'POST', 'public', {
    url: '/api/webhooks/mercadopago?data.id=123&type=payment',
    body: { type: 'payment', data: { id: '123' } },
    alsoAllowed: [401],
  }),

  // ── Phase 3 (reviews, likes, reports, moderation, profiles) ──
  R('/api/v1/items/[id]/reviews', 'GET', 'public', { params: { id: NO_ID } }),
  R('/api/v1/items/[id]/reviews', 'POST', 'user', {
    params: { id: NO_ID },
    body: { rating: 4, body: 'Matriz', containsSpoilers: false },
    headers: { 'x-turnstile-token': 'tok' },
  }),
  R('/api/v1/reviews', 'GET', 'public'),
  R('/api/v1/reviews/[id]', 'PATCH', 'user', { params: { id: NO_ID }, body: { rating: 3 } }),
  R('/api/v1/reviews/[id]', 'DELETE', 'user', { params: { id: NO_ID } }),
  R('/api/v1/reviews/[id]/like', 'PUT', 'user', { params: { id: NO_ID } }),
  R('/api/v1/reviews/[id]/like', 'DELETE', 'user', { params: { id: NO_ID } }),
  R('/api/v1/reviews/[id]/reports', 'POST', 'user', {
    params: { id: NO_ID },
    body: { reason: 'SPAM' },
  }),
  R('/api/v1/users/[username]', 'GET', 'public', {
    params: { username: 'ninguem_aqui' },
    url: '/api/v1/users/ninguem_aqui',
  }),
  R('/api/v1/users/[username]/reviews', 'GET', 'public', {
    params: { username: 'ninguem_aqui' },
    url: '/api/v1/users/ninguem_aqui/reviews',
  }),
  R('/api/v1/admin/moderation/queue', 'GET', 'moderator'),
  R('/api/v1/admin/moderation/reviews/[id]', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { action: 'HIDE', expectedStatus: 'VISIBLE' },
  }),

  // ── Phase 4 (live schedule, orders, people, overlays, media kit, contact, audit, settings) ──
  R('/api/v1/admin/live', 'GET', 'moderator'),
  R('/api/v1/admin/sessions', 'POST', 'moderator', {
    body: { startsAt: '2030-01-01T20:00:00.000Z', capacityMinutes: 240 },
  }),
  R('/api/v1/admin/sessions/[id]', 'PATCH', 'moderator', {
    params: { id: NO_ID },
    body: { expectedVersion: 0, capacityMinutes: 200 },
  }),
  R('/api/v1/admin/sessions/[id]/start', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: VERSION0,
  }),
  R('/api/v1/admin/sessions/[id]/end', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: VERSION0,
  }),
  R('/api/v1/admin/sessions/[id]/cancel', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: VERSION0,
  }),
  R('/api/v1/admin/sessions/[id]/order', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { expectedVersion: 0, entries: [`ORDER:${NO_ID}`] },
  }),
  R('/api/v1/admin/sessions/clear', 'POST', 'moderator'),
  R('/api/v1/admin/sessions/[id]/postpone', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { expectedVersion: 0, days: 1, cascade: true },
  }),
  R('/api/v1/admin/season', 'GET', 'moderator'),
  R('/api/v1/admin/season', 'PUT', 'moderator', { body: { theme: 'none', until: null } }),
  R('/api/v1/admin/popup', 'GET', 'moderator'),
  R('/api/v1/admin/popup', 'PUT', 'moderator', {
    body: {
      active: false,
      title: '',
      body: '',
      imageId: null,
      ctaLabel: null,
      ctaHref: null,
      until: null,
    },
  }),
  R('/api/v1/admin/schedule', 'POST', 'moderator', {
    body: { action: 'remove', target: { kind: 'ORDER', id: NO_ID, expectedVersion: 0 } },
    params: {},
  }),
  R('/api/v1/sessions', 'GET', 'public'),
  R('/api/v1/orders/[code]/reschedule', 'GET', 'user', {
    params: { code: NO_CODE },
    url: `/api/v1/orders/${NO_CODE}/reschedule`,
  }),
  R('/api/v1/orders/[code]/reschedule', 'POST', 'user', {
    params: { code: NO_CODE },
    url: `/api/v1/orders/${NO_CODE}/reschedule`,
    body: { sessionId: NO_ID },
  }),
  R('/api/v1/admin/orders', 'GET', 'moderator'),
  R('/api/v1/admin/orders/[id]', 'GET', 'moderator', { params: { id: NO_ID } }),
  R('/api/v1/admin/orders/[id]/texts', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { expectedVersion: 0, message: 'APPROVED' },
  }),
  R('/api/v1/admin/orders/[id]/accept', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: VERSION0,
  }),
  R('/api/v1/admin/orders/[id]/undo', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: VERSION0,
  }),
  R('/api/v1/admin/orders/manual', 'GET', 'moderator'),
  R('/api/v1/admin/orders/manual', 'POST', 'moderator', {
    body: { itemId: NO_ID, idempotencyKey: NO_ID },
  }),
  R('/api/v1/admin/orders/[id]/refund', 'POST', 'streamer', {
    params: { id: NO_ID },
    body: { expectedVersion: 0, reason: 'DUPLICATE_PAYMENT' },
    headers: { 'idempotency-key': NO_ID },
  }),
  R('/api/v1/admin/users', 'GET', 'moderator'),
  R('/api/v1/admin/users/[id]/suspend', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { days: 1 },
  }),
  R('/api/v1/admin/users/[id]/unsuspend', 'POST', 'moderator', { params: { id: NO_ID } }),
  R('/api/v1/admin/users/[id]/role', 'POST', 'streamer', {
    params: { id: NO_ID },
    body: { role: 'MODERATOR' },
  }),
  R('/api/v1/admin/users/[id]/vip', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { vip: true },
  }),
  R('/api/v1/admin/users/[id]/unthrottle', 'POST', 'moderator', { params: { id: NO_ID } }),
  R('/api/v1/me/export', 'GET', 'user'),
  R('/api/v1/me/erase', 'POST', 'user', { body: { confirmUsername: 'nao-confere' } }),
  R('/api/v1/admin/overlay-keys', 'GET', 'moderator'),
  R('/api/v1/admin/overlay-keys', 'POST', 'moderator', {
    body: { label: 'Matriz', widgets: ['agora'] },
  }),
  R('/api/v1/admin/overlay-keys/[id]', 'DELETE', 'moderator', { params: { id: NO_ID } }),
  // overlay credentials are the key / the overlay cookie, not a role: 401 without them
  R('/api/v1/overlay/session', 'POST', 'public', {
    body: { key: `wfo_${'A'.repeat(43)}` },
    alsoAllowed: [401],
  }),
  R('/api/v1/overlay/stream', 'GET', 'public', {
    url: '/api/v1/overlay/stream?widget=agora',
    alsoAllowed: [401],
  }),
  R('/api/v1/overlay/tts', 'GET', 'public', {
    url: '/api/v1/overlay/tts?id=1700000000000-abcdef',
    alsoAllowed: [401],
  }),
  R('/api/v1/admin/goals', 'GET', 'moderator'),
  R('/api/v1/admin/goals', 'POST', 'moderator', {
    body: {
      title: 'Matriz',
      metric: 'SPONSORSHIP_COUNT',
      target: 10,
      startsAt: '2030-01-01T00:00:00.000Z',
    },
  }),
  R('/api/v1/admin/goals/[id]', 'PATCH', 'moderator', {
    params: { id: NO_ID },
    body: { target: 5 },
  }),
  R('/api/v1/admin/goals/[id]', 'DELETE', 'moderator', { params: { id: NO_ID } }),
  // subathon timer (2026-11-03): streamer only
  R('/api/v1/admin/subathon', 'GET', 'moderator'),
  R('/api/v1/admin/subathon', 'POST', 'moderator', {
    body: {
      title: 'Matriz',
      initialSeconds: 3600,
      secondsPerReal: 60,
      capSeconds: null,
      rates: {
        bits100Cents: 500,
        tier1Cents: 1000,
        tier2Cents: 2000,
        tier3Cents: 5000,
        primeCents: 1000,
        usdCents: 550,
        eurCents: 600,
        count: {
          site: true,
          tips: true,
          bits: true,
          subs: true,
          resubs: true,
          prime: true,
          gifts: true,
        },
      },
    },
  }),
  R('/api/v1/admin/subathon/[id]', 'PATCH', 'moderator', {
    params: { id: NO_ID },
    body: { expectedVersion: 0, title: 'Matriz' },
  }),
  R('/api/v1/admin/subathon/[id]/action', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { action: 'start', expectedVersion: 0 },
  }),
  R('/api/v1/admin/subathon/[id]/adjust', 'POST', 'moderator', {
    params: { id: NO_ID },
    body: { seconds: 60, idempotencyKey: '00000000-0000-4000-8000-000000000001' },
  }),
  // subathon chat commands (2026-11-04): the key is the streamer's; the command answers with a key
  R('/api/v1/admin/subathon/command-key', 'POST', 'moderator'),
  R('/api/v1/admin/subathon/command-key', 'DELETE', 'moderator'),
  R('/api/v1/subathon/command', 'GET', 'public', {
    url: `/api/v1/subathon/command?a=tempo&k=wfc_${'A'.repeat(43)}`,
    // authenticates by its key, not by role (subathon.test.ts): a wrong key is 401 for everyone
    alsoAllowed: [401],
  }),
  R('/api/v1/admin/stats', 'GET', 'moderator'),
  R('/api/v1/admin/stats', 'PUT', 'moderator', {
    body: { platform: 'KICK', metric: 'followers', value: null },
  }),
  R('/api/v1/stats', 'GET', 'public'),
  R('/api/v1/live', 'GET', 'public'),
  R('/api/v1/contact', 'POST', 'public', {
    body: {
      name: 'Matriz',
      email: 'matriz@example.com',
      subject: 'Teste',
      body: 'Teste',
      website: '',
      formToken: 'x'.repeat(40),
    },
    headers: { 'x-turnstile-token': 'tok' },
  }),
  R('/api/v1/admin/contact', 'GET', 'moderator'),
  R('/api/v1/admin/contact/[id]', 'PATCH', 'moderator', {
    params: { id: NO_ID },
    body: { status: 'READ' },
  }),
  R('/api/v1/admin/contact/[id]', 'DELETE', 'moderator', { params: { id: NO_ID } }),
  R('/api/v1/admin/audit', 'GET', 'moderator'),
  R('/api/v1/admin/audit/export', 'GET', 'moderator'),
  R('/api/v1/admin/games', 'GET', 'moderator'),
  R('/api/v1/admin/games', 'POST', 'moderator', { body: { title: 'Matriz', status: 'PLAYING' } }),
  R('/api/v1/admin/games/[id]', 'PATCH', 'moderator', {
    params: { id: NO_ID },
    body: { title: 'Matriz', status: 'PLAYING', expectedVersion: 0 },
  }),
  R('/api/v1/admin/games/[id]', 'DELETE', 'moderator', { params: { id: NO_ID } }),
  R('/api/v1/admin/alerts', 'GET', 'moderator'),
  R('/api/v1/admin/alerts', 'PUT', 'moderator', {
    body: { voice: true, voiceName: 'pt-BR-Neural2-A', chat: true },
  }),
  R('/api/v1/admin/alerts/test', 'POST', 'moderator'),
  R('/api/v1/admin/settings', 'GET', 'moderator'),
  R('/api/v1/admin/settings', 'PUT', 'moderator', { body: { ordersOpen: true } }),
  R('/api/v1/admin/vouchers', 'GET', 'moderator'),
  R('/api/v1/admin/vouchers', 'POST', 'moderator', {
    body: {
      code: `MATRIZ-${Date.now().toString(36).toUpperCase()}`.slice(0, 32),
      kind: 'PERCENT',
      percentBps: 100,
      maxPerUser: 1,
    },
  }),
  R('/api/v1/admin/vouchers/[id]', 'PATCH', 'moderator', {
    params: { id: NO_ID },
    body: { active: false },
  }),

  // ── Phase 6 (links page, suggestions) ──
  R('/api/v1/admin/links', 'GET', 'moderator'),
  R('/api/v1/admin/links', 'POST', 'moderator', {
    body: { label: 'Matriz', url: 'https://example.com/matriz' },
  }),
  R('/api/v1/admin/links/[id]', 'PATCH', 'moderator', {
    params: { id: NO_ID },
    body: { visible: false },
  }),
  R('/api/v1/admin/links/[id]', 'DELETE', 'moderator', { params: { id: NO_ID } }),
  R('/api/v1/admin/links/order', 'PUT', 'moderator', { body: { ids: [] } }),
  R('/api/v1/suggestions', 'POST', 'user', {
    body: { kind: 'MOVIE', title: `Matriz ${Date.now()}` },
  }),
  R('/api/v1/admin/suggestions', 'GET', 'moderator'),
  R('/api/v1/admin/suggestions/[id]', 'PATCH', 'moderator', {
    params: { id: NO_ID },
    body: { status: 'ACCEPTED', expectedStatus: 'NEW' },
  }),
  // Roleta (2026-11-04): viewers spin and claim their own prizes; staff see what was won
  R('/api/v1/roleta', 'GET', 'user'),
  R('/api/v1/roleta/spin', 'POST', 'user', { body: {} }),
  R('/api/v1/roleta/prizes/[id]', 'PATCH', 'user', {
    params: { id: NO_ID },
    body: { twitchLogin: 'matriz_probe' },
  }),
  R('/api/v1/admin/roleta', 'GET', 'moderator'),
  R('/api/v1/admin/roleta/[id]', 'PATCH', 'moderator', {
    params: { id: NO_ID },
    body: { status: 'DELIVERED', expectedStatus: 'PENDING' },
  }),
  R('/api/v1/admin/roleta/open', 'PUT', 'moderator', { body: { open: true } }),
  // "Próximas temporadas" (Admin › Estreias)
  R('/api/v1/admin/releases', 'GET', 'moderator'),
  R('/api/v1/admin/releases', 'POST', 'moderator', {
    body: { title: 'Matriz', seasonLabel: 'Temporada 2', releaseDate: '2030-01-01' },
  }),
  R('/api/v1/admin/releases/[id]', 'PATCH', 'moderator', {
    params: { id: NO_ID },
    body: { note: 'Netflix' },
  }),
  R('/api/v1/admin/releases/[id]', 'DELETE', 'moderator', { params: { id: NO_ID } }),
];

const ROLES = ['anonymous', 'USER', 'MODERATOR', 'STREAMER'] as const;
const RANK = { anonymous: -1, USER: 0, MODERATOR: 1, STREAMER: 2 } as const;
const NEED = { public: -1, user: 0, moderator: 1, streamer: 2 } as const;

function expected(role: (typeof ROLES)[number], access: AccessLevel): 'allow' | 401 | 404 {
  if (RANK[role] >= NEED[access]) return 'allow';
  return role === 'anonymous' ? 401 : 404;
}

// Turnstile (checkout routes): Cloudflare's siteverify answers "success" for the probe token.
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string | URL) =>
    String(url).startsWith('https://challenges.cloudflare.com/')
      ? Response.json({ success: true })
      : Response.json({ message: 'unexpected outbound call in the authz matrix' }, { status: 599 }),
  );
});

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
              ...row.headers,
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
          expect([401, 403, 405].filter((s) => !row.alsoAllowed?.includes(s))).not.toContain(
            res.status,
          );
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
