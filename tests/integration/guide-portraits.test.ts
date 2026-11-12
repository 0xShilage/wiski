/**
 * Guia de Winden photos (2026-11-12, prisma/migrations/*_guide_portraits_constraints): the team
 * puts a PORTRAIT in a character slot; only real guides and slots, audited, readable by the page.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PUT } from '@/app/api/v1/admin/guides/[guide]/portraits/route';
import { db } from '@/server/db';
import { guidePortraits } from '@/server/guides/portraits';
import { clearCatalog, makeAsset } from '../support/catalog';
import { as, hit } from '../support/live';

beforeEach(async () => {
  await clearCatalog();
});

const put = (who: Awaited<ReturnType<typeof as>>, body: unknown, guide = 'dark') =>
  hit(PUT, 'PUT', `/api/v1/admin/guides/${guide}/portraits`, {
    who,
    body,
    params: { guide },
  });

describe('guide portraits', () => {
  it('a moderator fills a slot, replaces it and takes it out; every step audited', async () => {
    const mod = await as('MODERATOR');
    const first = await makeAsset('PORTRAIT');
    const r = await put(mod, { slot: 'jonas:2019', assetId: first.id });
    expect(r.res.status).toBe(200);
    expect((r.json.picture as { fallback: string } | null)?.fallback).toMatch(/^\/media\//);
    expect(Object.keys(await guidePortraits('dark'))).toEqual(['jonas:2019']);

    const second = await makeAsset('PORTRAIT');
    expect((await put(mod, { slot: 'jonas:2019', assetId: second.id })).res.status).toBe(200);
    const row = await db().guidePortrait.findUniqueOrThrow({
      where: { guide_slot: { guide: 'dark', slot: 'jonas:2019' } },
    });
    expect(row.assetId).toBe(second.id);
    expect(row.updatedById).toBe(mod.user.id);

    expect((await put(mod, { slot: 'jonas:2019', assetId: null })).res.status).toBe(200);
    expect(await guidePortraits('dark')).toEqual({});
    const actions = await db().auditLog.findMany({
      where: { actorId: mod.user.id, action: { startsWith: 'guide.portrait.' } },
      orderBy: { id: 'asc' },
      select: { action: true, metadata: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      'guide.portrait.set',
      'guide.portrait.set',
      'guide.portrait.remove',
    ]);
    expect(actions[0]!.metadata).toEqual({ guide: 'dark', slot: 'jonas:2019' });
  });

  it('only real slots, real guides and portrait uploads', async () => {
    const mod = await as('MODERATOR');
    const portrait = await makeAsset('PORTRAIT');
    const poster = await makeAsset('POSTER');
    expect((await put(mod, { slot: 'ninguem:2019', assetId: portrait.id })).res.status).toBe(422);
    expect((await put(mod, { slot: 'jonas:1953', assetId: portrait.id })).res.status).toBe(422);
    expect((await put(mod, { slot: 'jonas:2019', assetId: poster.id })).res.status).toBe(422);
    expect(
      (await put(mod, { slot: 'jonas:2019', assetId: '00000000-0000-7000-8000-000000000000' })).res
        .status,
    ).toBe(422);
    expect((await put(mod, { slot: 'jonas:2019', assetId: portrait.id }, 'lost')).res.status).toBe(
      404,
    );
    expect(await db().guidePortrait.count()).toBe(0);
  });

  it('viewers cannot touch it', async () => {
    const viewer = await as('USER');
    const portrait = await makeAsset('PORTRAIT');
    expect((await put(viewer, { slot: 'jonas:2019', assetId: portrait.id })).res.status).toBe(404);
  });

  it('the database only takes the shapes the code builds', async () => {
    const asset = await makeAsset('PORTRAIT');
    for (const [guide, slot] of [
      ['Dark', 'jonas:2019'],
      ['dark', 'jonas'],
      ['dark', 'jonas:19x6'],
      ['dark', '<img>:2019'],
      ['dark', 'jonas:2019 '],
    ])
      await expect(
        db().guidePortrait.create({ data: { guide: guide!, slot: slot!, assetId: asset.id } }),
      ).rejects.toThrow();
    // an asset in use can't be deleted from under the guide
    await db().guidePortrait.create({
      data: { guide: 'dark', slot: 'jonas:2019', assetId: asset.id },
    });
    await expect(db().mediaAsset.delete({ where: { id: asset.id } })).rejects.toThrow();
  });
});
