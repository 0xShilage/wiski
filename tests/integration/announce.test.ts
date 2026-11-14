/**
 * Anúncios automáticos (2026-11-13): the bot speaks on its own when a live starts, when something
 * goes on screen and when a badge opens during a live — once each, never failing the action, never
 * with the claim word, switchable and rewordable from Chat da live, audited as `chat.say` (auto).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUT as announcePut } from '@/app/api/v1/admin/chat/announce/route';
import { GET as chatGet } from '@/app/api/v1/admin/chat/route';
import { POST as scheduleRoute } from '@/app/api/v1/admin/schedule/route';
import { POST as startRoute } from '@/app/api/v1/admin/sessions/[id]/start/route';
import { DEFAULT_ANNOUNCE } from '@/lib/announce';
import { announceLiveStart, announceOpenBadges, programa } from '@/server/chat/announce';
import { db } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { redis } from '@/server/redis';
import { clearCatalog, makeAsset } from '../support/catalog';
import { makeUser } from '../support/db';
import { as, fundedCampaign, hit, makeSession, paidMovie, resetSlots } from '../support/live';

const JWT = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
  JSON.stringify({ channel: '5f0c0ffee0ddba11c0ffee00' }),
).toString('base64url')}.c2ln`;

let said: string[] = [];

beforeEach(async () => {
  said = [];
  await clearCatalog();
  await db().streamSession.deleteMany({});
  resetSlots();
  await db().appSetting.deleteMany({ where: { key: 'chat.announce' } });
  const keys = await redis().keys('wf:chat:*');
  if (keys.length) await redis().del(...keys);
  vi.stubEnv('STREAMELEMENTS_JWT', JWT);
  resetEnvCache();
  vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
    said.push((JSON.parse(String(init?.body ?? '{}')) as { message: string }).message);
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCache();
});

const host = () => new URL(process.env.APP_ORIGIN ?? 'https://localhost').host;

async function liveWithMovie(sponsored = true) {
  const mod = await as('MODERATOR');
  const fan = await makeUser();
  const { item, order } = await paidMovie({ user: fan, title: 'Aftersun' });
  if (sponsored)
    await db().order.update({ where: { id: order.id }, data: { showSponsorName: true } });
  const s = await makeSession({ inHours: 1 });
  const add = await hit(scheduleRoute, 'POST', '', {
    who: mod,
    body: {
      action: 'add',
      target: { kind: 'ORDER', id: order.id, expectedVersion: 0 },
      sessionId: s.id,
    },
  });
  expect(add.res.status).toBe(200);
  return { mod, fan, item, order, session: s };
}

describe('anúncios automáticos', () => {
  it('the live starts: "Hoje tem…", once, audited as automatic', async () => {
    const { mod, session } = await liveWithMovie();
    const r = await hit(startRoute, 'POST', '', {
      who: mod,
      params: { id: session.id },
      body: { expectedVersion: session.version },
    });
    expect(r.res.status).toBe(200);
    await vi.waitFor(() => expect(said).toHaveLength(1));
    expect(said[0]).toBe(`🔴 A live começou! Hoje tem: Aftersun. Agenda em ${host()}/cronograma`);
    // the same moment again (a retry, a second worker): nothing more
    await announceLiveStart(session.id);
    expect(said).toHaveLength(1);
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'chat.say', actorId: null },
      orderBy: { id: 'desc' },
    });
    expect(log.metadata).toMatchObject({ ok: true, auto: 'start' });
    const panel = await hit(chatGet, 'GET', '', { who: mod });
    expect((panel.json.history as { auto: string | null }[])[0]!.auto).toBe('start');
  });

  it('something goes on: the title and who brought it', async () => {
    const { mod, fan, order, session } = await liveWithMovie();
    await db().streamSession.update({
      where: { id: session.id },
      data: { status: 'LIVE', startedAt: new Date(), version: { increment: 1 } },
    });
    const now = await hit(scheduleRoute, 'POST', '', {
      who: mod,
      body: { action: 'now', target: { kind: 'ORDER', id: order.id, expectedVersion: 1 } },
    });
    expect(now.res.status).toBe(200);
    await vi.waitFor(() => expect(said).toHaveLength(1));
    expect(said[0]).toBe(`🎬 Agora na tela: Aftersun · patrocinado por @${fan.username} 💜`);
  });

  it('a series part names the part and the vaquinha; an anonymous sponsor is not named', async () => {
    const mod = await as('MODERATOR');
    const { item, campaign } = await fundedCampaign();
    await db().catalogItem.update({
      where: { id: item.id },
      data: { seasonCount: 1, episodeCount: 8, title: 'Dark' },
    });
    const s = await makeSession({ inHours: 1 });
    const part = await hit(scheduleRoute, 'POST', '', {
      who: mod,
      body: {
        action: 'part',
        campaignId: campaign.id,
        sessionId: s.id,
        season: 1,
        episodeFrom: 1,
        episodeTo: 3,
        minutes: 135,
      },
    });
    const segId = (part.json.segment as { id: string }).id;
    await db().streamSession.update({
      where: { id: s.id },
      data: { status: 'LIVE', startedAt: new Date(), version: { increment: 1 } },
    });
    const seg = await db().liveSegment.findUniqueOrThrow({ where: { id: segId } });
    await hit(scheduleRoute, 'POST', '', {
      who: mod,
      body: {
        action: 'now',
        target: { kind: 'SEGMENT', id: segId, expectedVersion: seg.version },
      },
    });
    await vi.waitFor(() => expect(said).toHaveLength(1));
    expect(said[0]).toBe('🎬 Agora na tela: Dark · T1 · E1–E3 · vaquinha de 3 apoiadores 💜');

    said = [];
    const { order } = await paidMovie({ title: 'Psicose' }); // a guest, no name shown
    await hit(scheduleRoute, 'POST', '', {
      who: mod,
      body: {
        action: 'add',
        target: { kind: 'ORDER', id: order.id, expectedVersion: 0 },
        sessionId: s.id,
      },
    });
    await hit(scheduleRoute, 'POST', '', {
      who: mod,
      body: { action: 'now', target: { kind: 'ORDER', id: order.id, expectedVersion: 1 } },
    });
    await vi.waitFor(() => expect(said).toHaveLength(1));
    expect(said[0]).toBe('🎬 Agora na tela: Psicose');
  });

  it('switched off or reworded from the panel; bad placeholders are refused', async () => {
    const mod = await as('MODERATOR');
    const put = (body: unknown) => hit(announcePut, 'PUT', '', { who: mod, body });
    const bad = await put({
      ...DEFAULT_ANNOUNCE,
      now: { on: true, text: 'Agora {agora}' },
    });
    expect(bad.res.status).toBe(422);
    expect(JSON.stringify(bad.json)).toContain('{agora}');
    const ok = await put({
      start: { on: false, text: DEFAULT_ANNOUNCE.start.text },
      now: DEFAULT_ANNOUNCE.now,
      badge: { on: true, text: '  🏅 {emblema} aberto!  ' },
    });
    expect(ok.res.status).toBe(200);
    expect((ok.json.announce as { badge: { text: string } }).badge.text).toBe(
      '🏅 {emblema} aberto!',
    );
    expect(
      (
        await db().auditLog.findFirstOrThrow({
          where: { action: 'chat.announce.update' },
          orderBy: { at: 'desc' }, // the latest: other files may have saved settings before
        })
      ).metadata,
    ).toEqual({ start: false, now: true, badge: true });

    const { session } = await liveWithMovie();
    await hit(startRoute, 'POST', '', {
      who: mod,
      params: { id: session.id },
      body: { expectedVersion: session.version },
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(said).toEqual([]);
    expect(
      (await hit(announcePut, 'PUT', '', { who: await as('USER'), body: DEFAULT_ANNOUNCE })).res
        .status,
    ).toBe(404);
  });

  it('a badge open during a live is announced once, without its word', async () => {
    const art = await makeAsset('BADGE');
    await db().badge.create({
      data: {
        slug: 'maratona',
        name: 'Maratona de Terror',
        description: '',
        assetId: art.id,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date('2026-11-15T02:59:00Z'),
        codeHash: Buffer.alloc(32, 7),
      },
    });
    await announceOpenBadges();
    expect(said).toEqual([]); // no live: wait for one
    await makeSession({ status: 'LIVE' });
    await announceOpenBadges();
    await announceOpenBadges();
    expect(said).toEqual([
      `🏅 Emblema aberto: Maratona de Terror! Resgate até sábado, 14/11 às 23:59 em ${host()}/emblemas`,
    ]);
    expect((await db().badge.findFirstOrThrow()).announcedAt).not.toBeNull();
  });

  it('without the bot nothing is tried', async () => {
    vi.stubEnv('STREAMELEMENTS_JWT', '');
    resetEnvCache();
    await makeSession({ status: 'LIVE' });
    await announceOpenBadges();
    expect(said).toEqual([]);
  });
});

describe('programa', () => {
  it('lists up to three', () => {
    expect(programa(['A'])).toBe('A');
    expect(programa(['A', 'B'])).toBe('A e B');
    expect(programa(['A', 'B', 'C'])).toBe('A, B e C');
    expect(programa(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C e mais 2');
  });
});
