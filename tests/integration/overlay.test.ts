/**
 * Stream overlays (Phase 4 exit criterion: overlay payload sanitisation). Keys are shown once and
 * stored hashed; the key → cookie exchange; widget scope; revocation; SSE snapshots; and every
 * string that reaches the stream goes through the sanitiser and a strict schema.
 */
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { inject, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { sha256Bytes } from '@/server/security/crypto';
import { plainText } from '@/server/text/sanitize';
import {
  goalEvent,
  LIMITS,
  nowPlayingEvent,
  overlayEventSchema,
  queueEvent,
  sponsorshipEvent,
  totalGoalEvent,
} from '@/server/overlay/events';
import { announcePaidOrder, overlayChannel, queueSnapshot } from '@/server/overlay/state';
import { sumTotals } from '@/server/goals/total';
import { overlayCookieSpec } from '@/server/overlay/keys';
import { GET as keysRoute, POST as createKeyRoute } from '@/app/api/v1/admin/overlay-keys/route';
import { DELETE as revokeRoute } from '@/app/api/v1/admin/overlay-keys/[id]/route';
import { POST as sessionRoute } from '@/app/api/v1/overlay/session/route';
import { GET as streamRoute } from '@/app/api/v1/overlay/stream/route';
import { POST as scheduleRoute } from '@/app/api/v1/admin/schedule/route';
import { clearCatalog, makeItem } from '../support/catalog';
import { openCampaignFor } from '../support/checkout';
import { call, req, setCookies } from '../support/http';
import { as, hit, makeSession, paidMovie, resetSlots } from '../support/live';
import { XSS_CORPUS } from '../support/xss-corpus';

beforeEach(async () => {
  await clearCatalog();
  await db().streamSession.deleteMany({});
  resetSlots();
});

async function newKey(widgets: string[] = ['agora', 'fila', 'meta', 'patrocinio']) {
  const r = await hit(createKeyRoute, 'POST', '/api/v1/admin/overlay-keys', {
    who: await as('STREAMER'),
    body: { label: 'OBS principal', widgets },
  });
  expect(r.res.status).toBe(201);
  return r.json as { key: string; overlay: { id: string; keyPrefix: string } };
}

async function exchange(key: string, current?: string) {
  const res = await call(
    sessionRoute,
    req('POST', '/api/v1/overlay/session', {
      body: { key },
      ...(current ? { cookies: { '__Host-wf_overlay': current } } : {}),
    }),
  );
  return { res, cookies: setCookies(res) };
}

/** Read the first SSE data event, then abort. */
async function firstEvent(cookie: string | null, widget: string) {
  const ac = new AbortController();
  const r = req('GET', `/api/v1/overlay/stream?widget=${widget}`, {
    cookies: cookie ? { '__Host-wf_overlay': cookie } : {},
  });
  const res = await call(
    streamRoute,
    new (r.constructor as typeof Request)(r, { signal: ac.signal }) as never,
  );
  if (res.status !== 200) return { status: res.status, event: null };
  const reader = res.body!.getReader();
  let text = '';
  while (!text.includes('\ndata: ') && !/^data: /m.test(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  ac.abort();
  await reader.cancel().catch(() => {});
  const line = text.split('\n').find((l) => l.startsWith('data: '))!;
  return { status: 200, event: JSON.parse(line.slice(6)) as Record<string, unknown> };
}

describe('overlay keys', () => {
  it('shown once, stored as SHA-256 only, listed without the key; streamer + step-up', async () => {
    const k = await newKey(['agora']);
    expect(k.key).toMatch(/^wfo_[\w-]{43}$/);
    const row = await db().overlayKey.findUniqueOrThrow({ where: { id: k.overlay.id } });
    expect(Buffer.from(row.keyHash).equals(Buffer.from(sha256Bytes(k.key)))).toBe(true);
    const list = await hit(keysRoute, 'GET', '/api/v1/admin/overlay-keys', {
      who: await as('STREAMER'),
    });
    expect(JSON.stringify(list.json)).not.toContain(k.key);
    const staleS = await as('STREAMER', { authTime: new Date(Date.now() - 3_600_000) });
    const r = await hit(createKeyRoute, 'POST', '', {
      who: staleS,
      body: { label: 'x', widgets: ['agora'] },
    });
    expect(r.json.code).toBe('STEP_UP_REQUIRED');
    const bad = await hit(createKeyRoute, 'POST', '', {
      who: await as('STREAMER'),
      body: { label: 'x', widgets: ['chat'] },
    });
    expect(bad.res.status).toBe(422);
  });

  it('step-up with a second factor: confirm on the page (fresh check), no Google round trip', async () => {
    // a stale Google login, factor checked 30 min ago (default) → asked to confirm, told how
    const s = await as('STREAMER', { authTime: new Date(Date.now() - 3_600_000) });
    await db().passkey.create({
      data: {
        userId: s.user.id,
        credentialId: randomBytes(32),
        publicKey: randomBytes(77),
        label: 'teste',
      },
    });
    const asked = await hit(createKeyRoute, 'POST', '', {
      who: s,
      body: { label: 'PC da live', widgets: ['fila'] },
    });
    expect(asked.res.status).toBe(401);
    expect(asked.json).toMatchObject({ code: 'STEP_UP_REQUIRED', stepUpFactors: 'passkey' });
    // the passkey/authenticator check stamps mfaAt = now (what /me/totp/verify does)
    await db().session.update({ where: { id: s.auth.session.id }, data: { mfaAt: new Date() } });
    const done = await hit(createKeyRoute, 'POST', '', {
      who: s,
      body: { label: 'PC da live', widgets: ['fila'] },
    });
    expect(done.res.status).toBe(201);
    // no factor at all (not possible for admins, but the problem still carries the Google URL)
    expect(String(asked.json.stepUpUrl)).toMatch(/^\/api\/auth\/google\/start\?stepUp=1/);
  });

  it('key → read-only cookie (HttpOnly, Secure, Strict, 12 h); wrong or revoked keys → 401', async () => {
    const k = await newKey(['agora', 'fila']);
    const ok = await exchange(k.key);
    expect(ok.res.status).toBe(200);
    expect(await ok.res.json()).toEqual({ widgets: ['agora', 'fila'] });
    const c = ok.cookies['__Host-wf_overlay']!;
    expect(c.attributes).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'strict',
      path: '/',
      'max-age': '43200',
    });

    expect((await exchange(`wfo_${'A'.repeat(43)}`)).res.status).toBe(401);
    expect((await exchange('não é chave')).res.status).toBe(401);

    expect((await firstEvent(c.value, 'agora')).status).toBe(200);
    expect((await firstEvent(c.value, 'meta')).status).toBe(401); // not one of this key's widgets
    expect((await firstEvent(null, 'agora')).status).toBe(401);
    expect((await firstEvent('forjado', 'agora')).status).toBe(401);

    const del = await hit(revokeRoute, 'DELETE', '', {
      who: await as('STREAMER'),
      params: { id: k.overlay.id },
    });
    expect(del.res.status).toBe(204);
    expect((await firstEvent(c.value, 'agora')).status).toBe(401);
    expect((await exchange(k.key)).res.status).toBe(401);
  });
});

describe('snapshots', () => {
  it('"Agora assistindo" and "Próximos da fila" follow the schedule; names only once approved', async () => {
    const k = await newKey();
    const cookie = (await exchange(k.key)).cookies['__Host-wf_overlay']!.value;
    expect((await firstEvent(cookie, 'agora')).event).toEqual({
      type: 'now-playing',
      title: null,
      kind: null,
      sponsor: null,
      message: null,
    });

    const mod = await as('MODERATOR');
    const s = await makeSession({ status: 'LIVE' });
    const fan = await as('USER');
    const a = await paidMovie({
      user: fan.user,
      title: 'O Esquilo Voltou',
      message: 'Mensagem pendente',
    });
    const b = await paidMovie({ guestName: 'Convidada', title: 'Segundo Filme', tier: 'topo' });
    for (const m of [a, b]) {
      await hit(scheduleRoute, 'POST', '', {
        who: mod,
        body: {
          action: 'add',
          target: { kind: 'ORDER', id: m.order.id, expectedVersion: 0 },
          sessionId: s.id,
        },
      });
    }
    await hit(scheduleRoute, 'POST', '', {
      who: mod,
      body: { action: 'now', target: { kind: 'ORDER', id: a.order.id, expectedVersion: 1 } },
    });
    const now = (await firstEvent(cookie, 'agora')).event;
    expect(now).toEqual({
      type: 'now-playing',
      title: 'O Esquilo Voltou',
      kind: 'MOVIE',
      sponsor: `@${fan.user.username}`,
      message: null,
    });

    const q = (await firstEvent(cookie, 'fila')).event as {
      items: { title: string; sponsor: string | null; jumped: boolean }[];
    };
    expect(q.items[0]).toEqual({ title: 'Segundo Filme', sponsor: null, jumped: true }); // guest name not approved yet
    expect(JSON.stringify(q)).not.toMatch(/example\.com|Convidada/);
  });

  it('revenue goals show a percentage only', async () => {
    await db().goal.create({
      data: {
        title: 'Meta do mês',
        metric: 'SPONSORSHIP_REVENUE_CENTS',
        target: 100_000,
        startsAt: new Date(Date.now() - 86_400_000),
      },
    });
    await paidMovie();
    const k = await newKey(['meta']);
    const cookie = (await exchange(k.key)).cookies['__Host-wf_overlay']!.value;
    const e = (await firstEvent(cookie, 'meta')).event!;
    expect(e).toMatchObject({
      type: 'goal',
      title: 'Meta do mês',
      metric: 'SPONSORSHIP_REVENUE_CENTS',
      current: null,
      target: null,
      percent: 2,
    });
    await db().goal.deleteMany({});
  });

  it('a paid order is announced on "Novo patrocínio" (published on Redis, sanitised)', async () => {
    const sub = new Redis(inject('redisUrl'));
    const got: string[] = [];
    await sub.subscribe(overlayChannel('patrocinio'));
    sub.on('message', (_c, m) => got.push(m));
    const fan = await as('USER');
    const { order } = await paidMovie({
      user: fan.user,
      title: `Filme ${String.fromCodePoint(0x202e)}invertido`,
    });
    await announcePaidOrder(order.id);
    for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 20));
    await sub.quit();
    expect(JSON.parse(got[0]!)).toEqual({
      type: 'new-sponsorship',
      title: 'Filme invertido',
      sponsor: `@${fan.user.username}`,
      message: null,
      voice: false,
      id: expect.stringMatching(/^\d{13}-[\w-]+$/),
      at: expect.any(String),
    });
  });
});

describe('one OBS, several keys (2026-11-01)', () => {
  it('npm run dev over http uses a plain cookie name (OBS drops __Host- on http://localhost)', () => {
    expect(
      overlayCookieSpec({ NODE_ENV: 'development', APP_ORIGIN: 'http://localhost:3000' }),
    ).toEqual({ name: 'wf_overlay_dev', secure: false });
    for (const env of [
      { NODE_ENV: 'development', APP_ORIGIN: 'https://dev.wiski.fun' },
      { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000' },
      { NODE_ENV: 'production', APP_ORIGIN: 'https://wiski.fun' },
    ]) {
      expect(overlayCookieSpec(env)).toEqual({ name: '__Host-wf_overlay', secure: true });
    }
  });

  it('the cookie keeps a grant per key: an older key no longer locks out a newer one', async () => {
    const older = await newKey(['agora', 'fila']);
    const newer = await newKey(['meta-total']);
    // OBS loads the newer source first, then the older one, in the same cookie jar
    const c1 = (await exchange(newer.key)).cookies['__Host-wf_overlay']!.value;
    const c2 = (await exchange(older.key, c1)).cookies['__Host-wf_overlay']!.value;
    expect((await firstEvent(c2, 'meta-total')).status).toBe(200);
    expect((await firstEvent(c2, 'fila')).status).toBe(200);
    expect((await firstEvent(c2, 'meta')).status).toBe(401); // neither key lists it

    // revoking one key closes only its widgets
    const streamer = await as('STREAMER');
    expect(
      (await hit(revokeRoute, 'DELETE', '', { who: streamer, params: { id: older.overlay.id } }))
        .res.status,
    ).toBe(204);
    expect((await firstEvent(c2, 'fila')).status).toBe(401);
    expect((await firstEvent(c2, 'meta-total')).status).toBe(200);
  });

  it('at most eight keys are remembered (newest first); a tampered cookie counts as none', async () => {
    let cookie: string | undefined;
    const made: { key: string }[] = [];
    for (let i = 0; i < 9; i++) {
      const k = await newKey([i === 0 ? 'patrocinio' : 'fila']);
      made.push(k);
      cookie = (await exchange(k.key, cookie)).cookies['__Host-wf_overlay']!.value;
    }
    // the first key (the only one with "patrocinio") fell off the end
    expect((await firstEvent(cookie!, 'patrocinio')).status).toBe(401);
    expect((await firstEvent(cookie!, 'fila')).status).toBe(200);
    const tampered = `${cookie!.slice(0, -4)}AAAA`;
    const fresh = (await exchange(made[0]!.key, tampered)).cookies['__Host-wf_overlay']!.value;
    expect((await firstEvent(fresh, 'patrocinio')).status).toBe(200);
    expect((await firstEvent(fresh, 'fila')).status).toBe(401);
  });
});

describe('"Meta total" (2026-11-01)', () => {
  it('adds every current goal: movies by price, series and franchises by campaign; percentages only', async () => {
    // a sponsored movie (R$ 20 of R$ 20) and an open one (R$ 0 of R$ 20)
    await paidMovie({ runtime: 100 });
    await makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot: 30, runtimeMinutes: 100 });
    // a series campaign: R$ 25 of R$ 100
    const { item: series } = await openCampaignFor(10_000);
    await db().campaign.update({
      where: { itemId: series.id },
      data: { raisedCents: 2_500, remainingCents: 7_500 },
    });
    // gone from the boards or not public yet: not counted
    await makeItem({ kind: 'MOVIE', status: 'WATCHED', slot: 31 });
    await makeItem({ kind: 'MOVIE', status: 'DRAFT' });

    const k = await newKey(['meta-total']);
    const cookie = (await exchange(k.key)).cookies['__Host-wf_overlay']!.value;
    const e = (await firstEvent(cookie, 'meta-total')).event!;
    expect(e).toEqual({
      type: 'goal-total',
      percent: 32, // R$ 45 of R$ 140
      titles: 3,
      funded: 1,
      kinds: [
        { kind: 'MOVIE', titles: 2, funded: 1, percent: 50 },
        { kind: 'SERIES', titles: 1, funded: 0, percent: 25 },
        { kind: 'FRANCHISE', titles: 0, funded: 0, percent: 0 },
      ],
    });
    expect(JSON.stringify(e)).not.toMatch(/14000|4500|2500|cents/i);
    // the key only opens what it lists
    expect((await firstEvent(cookie, 'meta')).status).toBe(401);
  });

  it('one key can hold all five widgets; anything that moves "Meta" refreshes "Meta total" too', async () => {
    const k = await newKey(['agora', 'fila', 'meta', 'meta-total', 'patrocinio']);
    expect(k.key).toMatch(/^wfo_/);
    const sub = new Redis(inject('redisUrl'));
    const got: string[] = [];
    await sub.subscribe(overlayChannel('meta-total'));
    sub.on('message', (_c, m) => got.push(m));
    const { order } = await paidMovie();
    await announcePaidOrder(order.id); // refreshes "fila" and "meta"
    for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 20));
    await sub.quit();
    expect(JSON.parse(got[0]!)).toMatchObject({
      type: 'goal-total',
      titles: 1,
      funded: 1,
      percent: 100,
    });
  });

  it('a title without any goal yet is left out; an empty board is 0 %', () => {
    const base = {
      runtimeMinutes: 100,
      manualPriceCents: null,
      seasonCount: null,
      campaign: null,
      franchiseEntries: [],
    };
    expect(sumTotals([])).toMatchObject({ titles: 0, funded: 0, percent: 0 });
    const t = sumTotals([
      { ...base, kind: 'SERIES', status: 'ACTIVE' }, // no seasons, no campaign → no goal
      { ...base, kind: 'SERIES', status: 'ACTIVE', seasonCount: 2 }, // formula: R$ 200, nothing raised
      {
        ...base,
        kind: 'FRANCHISE',
        status: 'FUNDED',
        campaign: { goalCents: 6_000, raisedCents: 9_000 }, // over-raised: capped at the goal
      },
    ]);
    expect(t).toMatchObject({ titles: 2, funded: 1, percent: 23 }); // 60 of 260
    expect(totalGoalEvent(t)).toMatchObject({ type: 'goal-total', percent: 23 });
  });

  it('a movie with a manual price counts that price', () => {
    const base = { seasonCount: null, campaign: null, franchiseEntries: [] };
    const t = sumTotals([
      { ...base, kind: 'MOVIE', status: 'SPONSORED', runtimeMinutes: 100, manualPriceCents: 6_000 },
      { ...base, kind: 'MOVIE', status: 'ACTIVE', runtimeMinutes: 100, manualPriceCents: null }, // R$ 20
    ]);
    expect(t).toMatchObject({ titles: 2, funded: 1, percent: 75 }); // 60 of 80
  });
});

describe('payload sanitisation (exit criterion)', () => {
  it.each(XSS_CORPUS.map((p) => [p]))(
    '%j as title, sponsor and message → inert, capped, schema-valid',
    (payload) => {
      const events = [
        nowPlayingEvent({ title: payload, kind: 'MOVIE', sponsor: payload, message: payload }),
        queueEvent([{ title: payload, sponsor: payload, jumped: false }]),
        goalEvent({
          title: payload,
          metric: 'SPONSORSHIP_COUNT',
          current: 1,
          target: 2,
          percent: 50,
        }),
        sponsorshipEvent(payload, payload),
      ];
      for (const e of events) {
        if (!e) continue;
        expect(overlayEventSchema.safeParse(e).success).toBe(true);
        for (const v of Object.values(e).flatMap((x) =>
          Array.isArray(x) ? x.flatMap((i) => Object.values(i)) : [x],
        )) {
          if (typeof v !== 'string') continue;
          expect(plainText(v)).toBe(v); // already a sanitiser fixpoint: no controls, bidi, invisibles, line breaks
          expect([...v].length).toBeLessThanOrEqual(LIMITS.message);
        }
      }
    },
  );

  it('cuts long strings with an ellipsis at the widget limits', () => {
    const e = nowPlayingEvent({
      title: 'x'.repeat(500),
      kind: 'MOVIE',
      sponsor: 'y'.repeat(100),
      message: 'z'.repeat(400),
    }) as {
      title: string;
      sponsor: string;
      message: string;
    };
    expect([...e.title]).toHaveLength(LIMITS.title);
    expect(e.title.endsWith('…')).toBe(true);
    expect([...e.sponsor]).toHaveLength(LIMITS.sponsor);
    expect([...e.message]).toHaveLength(LIMITS.message);
  });

  it('the schema refuses anything unsanitised, extra keys, HTML-ish types and too many items', () => {
    const rlo = String.fromCodePoint(0x202e);
    expect(
      overlayEventSchema.safeParse({ type: 'new-sponsorship', title: `a${rlo}b`, sponsor: null })
        .success,
    ).toBe(false);
    expect(
      overlayEventSchema.safeParse({ type: 'new-sponsorship', title: 'a\nb', sponsor: null })
        .success,
    ).toBe(false);
    expect(
      overlayEventSchema.safeParse({
        type: 'new-sponsorship',
        title: 'ok',
        sponsor: null,
        html: '<b>',
      }).success,
    ).toBe(false);
    expect(overlayEventSchema.safeParse({ type: 'html', body: '<script>' }).success).toBe(false);
    const six = Array.from({ length: 6 }, () => ({ title: 't', sponsor: null, jumped: false }));
    expect(overlayEventSchema.safeParse({ type: 'queue', items: six }).success).toBe(false);
    expect(
      overlayEventSchema.safeParse({
        type: 'goal',
        title: 't',
        metric: 'SPONSORSHIP_COUNT',
        current: 1,
        target: 2,
        percent: 101,
      }).success,
    ).toBe(false);
  });

  it('queue snapshot follows the cronograma, not the unscheduled queue, capped at 5', async () => {
    const s = await makeSession({ status: 'LIVE' });
    // 7 scheduled on the live session → the 5 nearest show
    for (let i = 0; i < 7; i++) {
      const { order } = await paidMovie();
      await db().order.update({
        where: { id: order.id },
        data: { status: 'SCHEDULED', sessionId: s.id, scheduledAt: new Date() },
      });
    }
    // and two paid-but-unscheduled movies (the Fila tab) that must NOT appear
    const loose = await paidMovie({ title: 'Solto na fila' });
    await paidMovie({ title: 'Outro solto' });
    const e = (await queueSnapshot()) as { items: { title: string }[] };
    expect(e.items).toHaveLength(5);
    expect(e.items.map((i) => i.title)).not.toContain('Solto na fila');
    expect(loose.order.status).toBe('PAID');
  });

  it('queue snapshot is empty when nothing is scheduled, even with a full queue', async () => {
    for (let i = 0; i < 3; i++) await paidMovie();
    const e = (await queueSnapshot()) as { items: unknown[] };
    expect(e.items).toHaveLength(0);
  });
});
