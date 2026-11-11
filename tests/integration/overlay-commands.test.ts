/**
 * !agora and !fila (2026-11-06): StreamElements chat commands that show the "Agora assistindo" /
 * "Próximos da fila" overlays for two minutes and answer in chat with titles only. Same key as
 * the subathon commands; a wrong key is 401 and shows nothing; a source that connects while the
 * widget is showing gets the time left.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as commandRoute from '@/app/api/v1/subathon/command/route';
import { db } from '@/server/db';
import { overlayChannel } from '@/server/overlay/publish';
import { pendingShow, SHOW_SECONDS } from '@/server/overlay/show';
import { redis } from '@/server/redis';
import { createCommandKey } from '@/server/subathon/command';
import { clearCatalog } from '../support/catalog';
import { call, req } from '../support/http';
import { as, makeSession, paidMovie, resetSlots } from '../support/live';

const run = (a: string, k: string) =>
  call(commandRoute.GET, req('GET', `/api/v1/subathon/command?a=${a}&k=${encodeURIComponent(k)}`));

/** What the overlay channel receives while `fn` runs. */
async function published(w: 'agora' | 'fila', fn: () => Promise<unknown>) {
  const sub = redis().duplicate();
  const got: string[] = [];
  await sub.subscribe(overlayChannel(w));
  sub.on('message', (_c, m) => got.push(m));
  await fn();
  await new Promise((r) => setTimeout(r, 100));
  await sub.quit();
  return got.map((m) => JSON.parse(m) as { type: string; seconds?: number });
}

beforeEach(async () => {
  await clearCatalog();
  await db().streamSession.deleteMany({});
  await db().appSetting.deleteMany({ where: { key: 'subathon.commandKey' } });
  await redis().del('wf:overlay:show:agora', 'wf:overlay:show:fila');
  resetSlots();
});

const ctx = async () => ({ actor: (await as('STREAMER')).user, requestId: null });

describe('!agora', () => {
  it('shows "Agora assistindo" for two minutes and answers with the title (no subathon needed)', async () => {
    const key = await createCommandKey(await ctx());
    expect(await (await run('agora', key)).text()).toBe('Nada passando agora na live.');

    const fan = await as('USER');
    const { item, order } = await paidMovie({ user: fan.user, title: 'O Filme da Noite' });
    const s = await makeSession({ inHours: 0 });
    await db().streamSession.update({
      where: { id: s.id },
      data: { status: 'LIVE', startedAt: new Date(), nowItemId: item.id },
    });
    await db().order.update({
      where: { id: order.id },
      data: { status: 'WATCHING', sessionId: s.id, scheduledAt: new Date() },
    });

    let res: Response | null = null;
    const events = await published('agora', async () => {
      res = await run('agora', key);
    });
    expect(res!.status).toBe(200);
    expect(res!.headers.get('content-type')).toMatch(/^text\/plain/);
    const text = await res!.text();
    expect(text).toBe('🎬 Agora na live: O Filme da Noite');
    expect(text).not.toContain(fan.user.username!); // never a sponsor's name in chat
    expect(events).toEqual([{ type: 'show', seconds: SHOW_SECONDS }]);

    // a source that opens now shows it for the time left; "fila" isn't affected
    const [frame] = await pendingShow('agora');
    const left = (JSON.parse(frame!.slice(6)) as { seconds: number }).seconds;
    expect(left).toBeGreaterThan(SHOW_SECONDS - 5);
    expect(left).toBeLessThanOrEqual(SHOW_SECONDS);
    expect(await pendingShow('fila')).toEqual([]);
  });
});

describe('!fila', () => {
  it('shows "Próximos da fila" and answers with the next three titles', async () => {
    const key = await createCommandKey(await ctx());
    expect(await (await run('fila', key)).text()).toBe('A fila está vazia por enquanto.');
    // "Próximos da fila" follows the cronograma (2026-11-10): schedule the titles on a session
    const s = await makeSession({ inHours: 0 });
    for (const title of ['Primeiro', 'Segundo', 'Terceiro', 'Quarto']) {
      const { order } = await paidMovie({
        title,
        paidAt: new Date(Date.now() - 60_000 * (10 - title.length)),
      });
      await db().order.update({
        where: { id: order.id },
        data: { status: 'SCHEDULED', sessionId: s.id, scheduledAt: new Date() },
      });
    }
    let res: Response | null = null;
    const events = await published('fila', async () => {
      res = await run('fila', key);
    });
    const text = await res!.text();
    expect(text).toMatch(/^📋 Próximos na live: 1\. \S+ · 2\. \S+ · 3\. \S+$/);
    expect(text.split('·')).toHaveLength(3);
    expect(events).toEqual([{ type: 'show', seconds: SHOW_SECONDS }]);
  });

  it('a wrong key is 401 and shows nothing', async () => {
    await createCommandKey(await ctx());
    const events = await published('fila', async () => {
      expect((await run('fila', `wfc_${'A'.repeat(43)}`)).status).toBe(401);
      expect((await run('agora', 'nada')).status).toBe(401);
    });
    expect(events).toEqual([]);
    expect(await pendingShow('fila')).toEqual([]);
    expect((await run('mostrar', `wfc_${'A'.repeat(43)}`)).status).toBe(422);
  });
});
