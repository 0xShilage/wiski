/**
 * "Novo patrocínio" (2026-11-09): the alert carries the sponsor's name — @username when logged
 * in, the typed name for a guest, null when anonymous — and the message, both without links or
 * swear words; a Brazilian Portuguese voice (Google TTS) is made on the server and fetched by the
 * overlay with its cookie; the StreamElements bot thanks the sponsor in chat once per order;
 * "Já pago" orders are announced too; the switches live in Overlays.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as alertsGet, PUT as alertsPut } from '@/app/api/v1/admin/alerts/route';
import { POST as alertsTest } from '@/app/api/v1/admin/alerts/test/route';
import { POST as manualRoute } from '@/app/api/v1/admin/orders/manual/route';
import { POST as createKeyRoute } from '@/app/api/v1/admin/overlay-keys/route';
import { POST as sessionRoute } from '@/app/api/v1/overlay/session/route';
import { GET as ttsRoute } from '@/app/api/v1/overlay/tts/route';
import { db } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { chatLine, spokenLine } from '@/server/overlay/alerts';
import { overlayChannel } from '@/server/overlay/publish';
import { announcePaidOrder } from '@/server/overlay/state';
import { redis } from '@/server/redis';
import { clearCatalog } from '../support/catalog';
import { liveMovie } from '../support/checkout';
import { call, req, setCookies } from '../support/http';
import { as, hit, paidMovie, resetSlots } from '../support/live';

const KEY = `AIza${'x'.repeat(35)}`;
// header.payload.signature, payload {"channel":"5f0c0ffee0ddba11c0ffee00"}
const JWT = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
  JSON.stringify({ channel: '5f0c0ffee0ddba11c0ffee00' }),
).toString('base64url')}.c2ln`;
const MP3 = Buffer.from('ID3fake-mp3-bytes');

type Sent = { url: string; body: Record<string, unknown>; headers: Headers };
let sent: Sent[] = [];

beforeEach(async () => {
  await clearCatalog();
  await db().appSetting.deleteMany({ where: { key: 'alerts' } });
  const keys = await redis().keys('wf:se:said:*');
  if (keys.length) await redis().del(...keys);
  resetSlots();
  sent = [];
  vi.stubEnv('GOOGLE_TTS_API_KEY', KEY);
  vi.stubEnv('STREAMELEMENTS_JWT', JWT);
  resetEnvCache();
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    sent.push({
      url: u,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    });
    if (u.startsWith('https://texttospeech.googleapis.com/')) {
      return Response.json({ audioContent: MP3.toString('base64') });
    }
    if (u.startsWith('https://api.streamelements.com/')) return Response.json({ ok: true });
    return Response.json({ success: true }); // Turnstile and anything else
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCache();
});

/** What the "patrocinio" channel receives while `fn` runs. */
async function alerts(fn: () => Promise<unknown>) {
  const sub = redis().duplicate();
  const got: Record<string, unknown>[] = [];
  await sub.subscribe(overlayChannel('patrocinio'));
  sub.on('message', (_c, m) => got.push(JSON.parse(m) as Record<string, unknown>));
  await fn();
  for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 20));
  await sub.quit();
  return got;
}

const google = () => sent.filter((s) => s.url.startsWith('https://texttospeech'));
const chat = () => sent.filter((s) => s.url.includes('/bot/'));

describe('who and what the alert shows', () => {
  it('a guest with a name and a message: both shown, the swear word and the link taken out', async () => {
    const { order, item } = await paidMovie({
      guestName: 'Tia Lu',
      message: 'Que filme da porra! veja meusite.com',
      title: 'Duna',
    });
    await db().order.update({
      where: { id: order.id },
      data: { displayNameStatus: 'APPROVED', messageStatus: 'APPROVED' },
    });
    const [e] = await alerts(() => announcePaidOrder(order.id));
    expect(e).toMatchObject({
      type: 'new-sponsorship',
      title: item.title,
      sponsor: 'Tia Lu',
      message: 'Que filme da ***! veja',
      voice: true,
    });
    // the voice says it without the masked word; the key goes in a header, not the URL
    const [tts] = google();
    expect(tts!.url).not.toContain(KEY);
    expect(tts!.headers.get('x-goog-api-key')).toBe(KEY);
    expect(tts!.body).toMatchObject({
      input: { text: 'Tia Lu patrocinou Duna! Que filme da! veja' },
      voice: { languageCode: 'pt-BR', name: 'pt-BR-Neural2-A' },
    });
    // the chat thanks once, through the channel in the JWT
    expect(chat()).toHaveLength(1);
    expect(chat()[0]!.url).toBe(
      'https://api.streamelements.com/kappa/v2/bot/5f0c0ffee0ddba11c0ffee00/say',
    );
    expect(chat()[0]!.body).toEqual({
      message: 'Tia Lu patrocinou Duna! Muito obrigada por seu apoio 🍿🎥',
    });
    await announcePaidOrder(order.id);
    expect(chat()).toHaveLength(1);
  });

  it('logged in: the @username; anonymous: no name anywhere', async () => {
    const fan = await as('USER');
    const named = await paidMovie({ user: fan.user, title: 'Com nome' });
    const [a] = await alerts(() => announcePaidOrder(named.order.id));
    expect(a!.sponsor).toBe(`@${fan.user.username}`);
    expect(google().at(-1)!.body).toMatchObject({
      input: { text: `${fan.user.username} patrocinou Com nome!` },
    });

    const anon = await paidMovie({ user: fan.user, title: 'Sem nome' });
    await db().order.update({ where: { id: anon.order.id }, data: { showSponsorName: false } });
    const [b] = await alerts(() => announcePaidOrder(anon.order.id));
    expect(b).toMatchObject({ sponsor: null, message: null });
    expect(google().at(-1)!.body).toMatchObject({
      input: { text: 'Alguém anônimo patrocinou Sem nome!' },
    });
    expect(chat().at(-1)!.body).toEqual({
      message: 'Alguém patrocinou Sem nome! Muito obrigada por seu apoio 🍿🎥',
    });
  });

  it('a name that would start a chat command never does', () => {
    expect(chatLine({ sponsor: '/ban', title: 'X' })).toBe(
      'ban patrocinou X! Muito obrigada por seu apoio 🍿🎥',
    );
    expect(spokenLine({ sponsor: null, title: 'X', message: '  ' })).toBe(
      'Alguém anônimo patrocinou X!',
    );
  });
});

async function overlayCookie(widgets: string[]) {
  const r = await hit(createKeyRoute, 'POST', '/api/v1/admin/overlay-keys', {
    who: await as('STREAMER'),
    body: { label: 'OBS', widgets },
  });
  const res = await call(
    sessionRoute,
    req('POST', '/api/v1/overlay/session', { body: { key: r.json.key } }),
  );
  return setCookies(res)['__Host-wf_overlay']!.value;
}

describe('the voice', () => {
  it('is served to an overlay with the "patrocinio" widget, as MP3', async () => {
    const { order } = await paidMovie({ title: 'Com voz' });
    const [e] = await alerts(() => announcePaidOrder(order.id));
    const id = e!.id as string;
    const get = (cookie: string | null, alertId = id) =>
      call(
        ttsRoute,
        req('GET', `/api/v1/overlay/tts?id=${alertId}`, {
          cookies: cookie ? { '__Host-wf_overlay': cookie } : {},
        }),
      );
    const ok = await get(await overlayCookie(['patrocinio']));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await ok.arrayBuffer()).equals(MP3)).toBe(true);

    expect((await get(null)).status).toBe(401);
    expect((await get(await overlayCookie(['fila']))).status).toBe(401);
    expect((await get(await overlayCookie(['patrocinio']), '1700000000000-nothere')).status).toBe(
      404,
    );
  });

  it('switched off, or Google failing: the alert still goes out, without voice', async () => {
    const st = await as('STREAMER');
    const logged = () =>
      db().auditLog.count({ where: { action: 'alerts.update', targetId: 'alerts' } });
    const before = await logged();
    const put = await hit(alertsPut, 'PUT', '/api/v1/admin/alerts', {
      who: st,
      body: { voice: false, voiceName: 'pt-BR-Neural2-B', chat: false },
    });
    expect(put.res.status).toBe(200);
    const { order } = await paidMovie({ title: 'Mudo' });
    const [e] = await alerts(() => announcePaidOrder(order.id));
    expect(e).toMatchObject({ title: 'Mudo', voice: false });
    expect(google()).toHaveLength(0);
    expect(chat()).toHaveLength(0);
    expect(await logged()).toBe(before + 1);

    await hit(alertsPut, 'PUT', '', {
      who: st,
      body: { voice: true, voiceName: 'pt-BR-Neural2-B', chat: true },
    });
    vi.stubGlobal('fetch', async () => new Response('quota', { status: 429 }));
    const other = await paidMovie({ title: 'Google fora' });
    const [f] = await alerts(() => announcePaidOrder(other.order.id));
    expect(f).toMatchObject({ title: 'Google fora', voice: false });
  });

  it('without the Google key: no voice; the dashboard says so', async () => {
    vi.stubEnv('GOOGLE_TTS_API_KEY', '');
    resetEnvCache();
    const r = await hit(alertsGet, 'GET', '/api/v1/admin/alerts', { who: await as('MODERATOR') });
    expect(r.json.alerts).toMatchObject({ voice: true, voiceReady: false, chatReady: true });
    const { order } = await paidMovie({ title: 'Sem chave' });
    const [e] = await alerts(() => announcePaidOrder(order.id));
    expect(e!.voice).toBe(false);
    expect(google()).toHaveLength(0);
  });
});

describe('"Já pago" and "Testar alerta"', () => {
  it('a "Já pago" is announced on stream and in chat; a test alert never goes to chat', async () => {
    const st = await as('STREAMER');
    const movie = await liveMovie(100);
    const got = await alerts(() =>
      hit(manualRoute, 'POST', '/api/v1/admin/orders/manual', {
        who: st,
        body: { idempotencyKey: randomUUID(), itemId: movie.id, sponsorName: 'Tia Lu' },
      }),
    );
    expect(got[0]).toMatchObject({ title: movie.title, sponsor: 'Tia Lu' });
    expect(chat()).toHaveLength(1);

    const mod = await as('MODERATOR');
    const test = await alerts(() =>
      hit(alertsTest, 'POST', '/api/v1/admin/alerts/test', { who: mod }),
    );
    expect(test[0]).toMatchObject({ title: 'Filme de teste', sponsor: 'Wiskiflix', voice: true });
    expect(chat()).toHaveLength(1);
  });
});
