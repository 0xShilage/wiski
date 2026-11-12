/**
 * Chat da live (2026-11-11, docs/phase-6/README.md §34): the dashboard writes to the Twitch chat as
 * the StreamElements bot. What is sent, what is refused, the audit trail and the saved messages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as chatGet, POST as chatPost } from '@/app/api/v1/admin/chat/route';
import { PUT as presetsPut } from '@/app/api/v1/admin/chat/presets/route';
import { db } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { redis } from '@/server/redis';
import { as, hit } from '../support/live';

// header.payload.signature, payload {"channel":"5f0c0ffee0ddba11c0ffee00"}
const JWT = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
  JSON.stringify({ channel: '5f0c0ffee0ddba11c0ffee00' }),
).toString('base64url')}.c2ln`;

type Sent = { url: string; body: Record<string, unknown>; auth: string | null };
let sent: Sent[] = [];
let answer = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

beforeEach(async () => {
  sent = [];
  answer = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  await db().appSetting.deleteMany({ where: { key: 'chat.presets' } });
  await db().streamSession.deleteMany({});
  const keys = await redis().keys('wf:chat:sent:*');
  if (keys.length) await redis().del(...keys);
  vi.stubEnv('STREAMELEMENTS_JWT', JWT);
  resetEnvCache();
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    sent.push({
      url: u,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      auth: new Headers(init?.headers).get('authorization'),
    });
    return answer();
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCache();
});

const say = (who: Awaited<ReturnType<typeof as>>, text: string) =>
  hit(chatPost, 'POST', '/api/v1/admin/chat', { who, body: { text } });

describe('sending', () => {
  it('a moderator sends one line as the bot, and it is audited with who sent it', async () => {
    const mod = await as('MODERATOR');
    const { res, json } = await say(mod, '  Boa noite,\n chat!  ');
    expect(res.status).toBe(201);
    expect((json.sent as { text: string }).text).toBe('Boa noite, chat!');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(
      'https://api.streamelements.com/kappa/v2/bot/5f0c0ffee0ddba11c0ffee00/say',
    );
    expect(sent[0]!.body).toEqual({ message: 'Boa noite, chat!' });
    expect(sent[0]!.auth).toBe(`Bearer ${JWT}`);
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'chat.say', actorId: mod.user.id },
    });
    expect(log.metadata).toEqual({
      text: 'Boa noite, chat!',
      ok: true,
      reason: null,
      status: null,
    });

    const panel = await hit(chatGet, 'GET', '/api/v1/admin/chat', { who: mod });
    expect(panel.res.status).toBe(200);
    const history = panel.json.history as { text: string; by: string | null; ok: boolean }[];
    expect(history[0]).toMatchObject({ text: 'Boa noite, chat!', ok: true, by: mod.user.username });
    expect(panel.json.ready).toBe(true);
  });

  it('fills the placeholders when sent, and refuses when one has no value', async () => {
    const mod = await as('MODERATOR');
    const { json } = await say(mod, 'Site: {site}');
    expect((json.sent as { text: string }).text).toMatch(/^Site: [\w.:-]+$/);
    expect(String(sent[0]!.body.message)).not.toContain('{site}');

    const now = await say(mod, 'Passando: {agora}');
    expect(now.res.status).toBe(422);
    expect(JSON.stringify(now.json)).toContain('nada está marcado como passando agora');
    const next = await say(mod, 'Próxima: {proxima}');
    expect(next.res.status).toBe(422);

    await db().streamSession.create({
      data: { startsAt: new Date(Date.now() + 86_400_000), capacityMinutes: 120 },
    });
    const ok = await say(mod, 'Próxima: {proxima}');
    expect(ok.res.status).toBe(201);
    expect((ok.json.sent as { text: string }).text).toMatch(
      /^Próxima: .+, \d{2}\/\d{2} às \d{2}:\d{2}$/,
    );
    expect(sent).toHaveLength(2);
  });

  it('refuses Twitch commands, empty and too long messages (nothing reaches StreamElements)', async () => {
    const mod = await as('STREAMER');
    for (const text of [
      '/ban alguem',
      '.clear',
      '   ',
      'x'.repeat(501),
      // invisible characters in front of a command (pentest 2026-11-11)
      '\u200b/ban alguem',
      '\u2060.timeout alguem 600',
      '\ufeff/mod alguem',
    ]) {
      const { res } = await say(mod, text);
      expect(res.status, text.slice(0, 10)).toBe(422);
    }
    expect((await say(mod, '!proximo')).res.status).toBe(201);
    expect((await say(mod, '🍿'.repeat(500))).res.status).toBe(201);
    expect(sent).toHaveLength(2);
  });

  it('the same text twice in a row is a double click', async () => {
    const mod = await as('MODERATOR');
    expect((await say(mod, 'Oi!')).res.status).toBe(201);
    const again = await say(mod, 'Oi!');
    expect(again.res.status).toBe(409);
    expect(again.json.code).toBe('CHAT_DUPLICATE');
    expect(sent).toHaveLength(1);
  });

  it('a refusal from StreamElements is explained, audited as not sent, and can be retried', async () => {
    const mod = await as('MODERATOR');
    answer = () => new Response('nope', { status: 401 });
    const first = await say(mod, 'Teste');
    expect(first.res.status).toBe(502);
    expect(String(first.json.detail)).toContain('JWT');
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'chat.say', actorId: mod.user.id },
    });
    expect(log.metadata).toEqual({ text: 'Teste', ok: false, reason: 'rejected', status: 401 });

    answer = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
    expect((await say(mod, 'Teste')).res.status).toBe(201);
  });

  it('without STREAMELEMENTS_JWT nothing is sent and the panel says so', async () => {
    vi.stubEnv('STREAMELEMENTS_JWT', '');
    resetEnvCache();
    const mod = await as('MODERATOR');
    const { res, json } = await say(mod, 'Oi');
    expect(res.status).toBe(409);
    expect(json.code).toBe('CHAT_NOT_CONFIGURED');
    expect(sent).toHaveLength(0);
    const panel = await hit(chatGet, 'GET', '/api/v1/admin/chat', { who: mod });
    expect(panel.json.ready).toBe(false);
  });

  it('viewers cannot send', async () => {
    const viewer = await as('USER');
    expect((await say(viewer, 'Oi')).res.status).toBe(404); // admin routes do not exist for viewers
    expect(sent).toHaveLength(0);
  });
});

describe('saved messages', () => {
  it('starts with a few defaults, then keeps what the team saves (in order)', async () => {
    const mod = await as('MODERATOR');
    const start = await hit(chatGet, 'GET', '/api/v1/admin/chat', { who: mod });
    const defaults = start.json.presets as { id: string; label: string; text: string }[];
    expect(defaults.length).toBeGreaterThan(2);
    expect(defaults.some((p) => p.text.includes('{site}'))).toBe(true);

    const put = await hit(presetsPut, 'PUT', '/api/v1/admin/chat/presets', {
      who: mod,
      body: {
        presets: [
          { label: ' Hidratar ', text: '💧 Bebam água, chat!' },
          { id: defaults[0]!.id, label: defaults[0]!.label, text: defaults[0]!.text },
        ],
      },
    });
    expect(put.res.status).toBe(200);
    const saved = put.json.presets as { id: string; label: string; text: string }[];
    expect(saved.map((p) => p.label)).toEqual(['Hidratar', defaults[0]!.label]);
    expect(saved[0]!.id).toMatch(/^[\w-]+$/);
    expect(saved[1]!.id).toBe(defaults[0]!.id);
    const again = await hit(chatGet, 'GET', '/api/v1/admin/chat', { who: mod });
    expect(again.json.presets).toEqual(saved);
    expect(
      await db().auditLog.count({ where: { action: 'chat.presets.update', actorId: mod.user.id } }),
    ).toBe(1);
  });

  it('refuses a nameless message, a command, a duplicate id or more than 20', async () => {
    const mod = await as('MODERATOR');
    const put = (presets: unknown[]) =>
      hit(presetsPut, 'PUT', '/api/v1/admin/chat/presets', { who: mod, body: { presets } });
    expect((await put([{ label: '', text: 'Oi' }])).res.status).toBe(422);
    expect((await put([{ label: 'Ban', text: '/ban x' }])).res.status).toBe(422);
    expect(
      (
        await put([
          { id: 'a', label: 'A', text: 'a' },
          { id: 'a', label: 'B', text: 'b' },
        ])
      ).res.status,
    ).toBe(422);
    expect(
      (await put(Array.from({ length: 21 }, (_, i) => ({ label: `M${i}`, text: 'oi' })))).res
        .status,
    ).toBe(422);
    // an empty list is a choice
    expect((await put([])).res.status).toBe(200);
  });
});
