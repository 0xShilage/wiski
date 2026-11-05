/**
 * Overlays that keep working (2026-11-05): stream slots are leases that a crashed or redeployed
 * process can't leak; an OBS with many sources fits; streams send visible pings; and a
 * "Novo patrocínio" alert published while an overlay was reconnecting is replayed to it once.
 */
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as createKeyRoute } from '@/app/api/v1/admin/overlay-keys/route';
import { POST as sessionRoute } from '@/app/api/v1/overlay/session/route';
import { GET as streamRoute } from '@/app/api/v1/overlay/stream/route';
import { db } from '@/server/db';
import { ALERT_REPLAY_MS, missedAlerts } from '@/server/overlay/publish';
import { announcePaidOrder } from '@/server/overlay/state';
import { acquireStreamSlot, LEASE_MS } from '@/server/realtime/events';
import { clearCatalog } from '../support/catalog';
import { call, req, setCookies } from '../support/http';
import { as, hit, paidMovie, resetSlots } from '../support/live';

beforeEach(async () => {
  await clearCatalog();
  await db().streamSession.deleteMany({});
  resetSlots();
});

const tick = () => new Promise((r) => setTimeout(r, 30));

describe('stream slots are leases', () => {
  it('a full key refuses; a released slot frees a place', async () => {
    const key = `test:${randomBytes(6).toString('hex')}`;
    const a = await acquireStreamSlot(key, 2);
    const b = await acquireStreamSlot(key, 2);
    expect(a && b).toBeTruthy();
    expect(await acquireStreamSlot(key, 2)).toBeNull();
    a!.release();
    await tick();
    expect(await acquireStreamSlot(key, 2)).not.toBeNull();
  });

  it('slots of a process that died (never released) expire; a renewed one stays', async () => {
    const key = `test:${randomBytes(6).toString('hex')}`;
    let t = Date.now();
    const clock = () => t;
    const kept = await acquireStreamSlot(key, 3, clock);
    await acquireStreamSlot(key, 3, clock); // "crashed": never released
    await acquireStreamSlot(key, 3, clock); // "crashed": never released
    expect(await acquireStreamSlot(key, 3, clock)).toBeNull();
    t += LEASE_MS - 5_000;
    kept!.renew(); // its heartbeat
    await tick();
    t += 10_000; // the two dead ones are now older than a lease
    expect(await acquireStreamSlot(key, 3, clock)).not.toBeNull();
    expect(await acquireStreamSlot(key, 3, clock)).not.toBeNull();
    // the renewed one still counts: the set is full again
    expect(await acquireStreamSlot(key, 3, clock)).toBeNull();
  });
});

async function overlayCookie(widgets: string[]) {
  const r = await hit(createKeyRoute, 'POST', '/api/v1/admin/overlay-keys', {
    who: await as('STREAMER'),
    body: { label: 'OBS', widgets },
  });
  expect(r.res.status).toBe(201);
  const res = await call(
    sessionRoute,
    req('POST', '/api/v1/overlay/session', { body: { key: r.json.key } }),
  );
  return setCookies(res)['__Host-wf_overlay']!.value;
}

/** The frames a stream sends up to (and including) its first ping. */
async function framesUntilPing(cookie: string, query: string) {
  const ac = new AbortController();
  const r = req('GET', `/api/v1/overlay/stream?${query}`, {
    cookies: { '__Host-wf_overlay': cookie },
  });
  const res = await call(
    streamRoute,
    new (r.constructor as typeof Request)(r, { signal: ac.signal }) as never,
  );
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  let text = '';
  while (!text.includes('event: ping')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  ac.abort();
  await reader.cancel().catch(() => {});
  return text.split('\n\n').filter(Boolean);
}

describe('"Novo patrocínio" across a reconnect', () => {
  it('an alert published while the overlay was away is replayed once it asks with `since`', async () => {
    const cookie = await overlayCookie(['patrocinio', 'agora']);
    const before = new Date(Date.now() - 1_000).toISOString();
    const fan = await as('USER');
    const title = `Filme ${randomBytes(3).toString('hex')}`;
    const { order } = await paidMovie({ user: fan.user, title });
    await announcePaidOrder(order.id);

    const replayed = await framesUntilPing(cookie, `widget=patrocinio&since=${before}`);
    const alerts = replayed
      .filter((f) => f.startsWith('data: ') && f.includes(title))
      .map((f) => JSON.parse(f.slice(6)) as { type: string; id: string; at: string });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'new-sponsorship', title });
    // the stream opens with the snapshot, then the replay, then a ping with the server time
    expect(replayed[1]).toBe('data: {"type":"ready"}');
    const ping = replayed.find((f) => f.startsWith('event: ping'))!;
    expect(JSON.parse(ping.split('data: ')[1]!)).toEqual({ at: expect.any(String) });

    // a fresh source (no since) and a source that already saw it get nothing old
    expect((await framesUntilPing(cookie, 'widget=patrocinio')).join()).not.toContain(title);
    const after = new Date(Date.parse(alerts[0]!.at) + 1).toISOString();
    expect(
      (await framesUntilPing(cookie, `widget=patrocinio&since=${after}`)).join(),
    ).not.toContain(title);
    // other widgets never replay alerts
    expect((await framesUntilPing(cookie, `widget=agora&since=${before}`)).join()).not.toContain(
      title,
    );
    // and nothing older than the replay window comes back
    const late = new Date(Date.parse(alerts[0]!.at) + ALERT_REPLAY_MS + 1_000);
    expect((await missedAlerts(before, late)).join()).not.toContain(title);
  });

  it('`since` must be a timestamp', async () => {
    const cookie = await overlayCookie(['patrocinio']);
    const res = await call(
      streamRoute,
      req('GET', '/api/v1/overlay/stream?widget=patrocinio&since=ontem', {
        cookies: { '__Host-wf_overlay': cookie },
      }),
    );
    expect(res.status).toBe(422);
  });
});
