/**
 * Stream overlays (Phase 4 exit criterion: overlay payload sanitisation). Keys are shown once and
 * stored hashed; the key → cookie exchange; widget scope; revocation; SSE snapshots; and every
 * string that reaches the stream goes through the sanitiser and a strict schema.
 */
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
} from '@/server/overlay/events';
import { announcePaidOrder, overlayChannel, queueSnapshot } from '@/server/overlay/state';
import { GET as keysRoute, POST as createKeyRoute } from '@/app/api/v1/admin/overlay-keys/route';
import { DELETE as revokeRoute } from '@/app/api/v1/admin/overlay-keys/[id]/route';
import { POST as sessionRoute } from '@/app/api/v1/overlay/session/route';
import { GET as streamRoute } from '@/app/api/v1/overlay/stream/route';
import { POST as scheduleRoute } from '@/app/api/v1/admin/schedule/route';
import { clearCatalog } from '../support/catalog';
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

async function exchange(key: string) {
  const res = await call(sessionRoute, req('POST', '/api/v1/overlay/session', { body: { key } }));
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
    });
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

  it('queue snapshot never exceeds 5 items', async () => {
    for (let i = 0; i < 7; i++) await paidMovie();
    const e = (await queueSnapshot()) as { items: unknown[] };
    expect(e.items).toHaveLength(5);
  });
});
