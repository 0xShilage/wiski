/**
 * A movie's extra backgrounds (2026-11-14): up to four more after the main one, in order; the
 * title page gets all of them, revisions keep them (revert restores them), audited by field name;
 * movies only, BACKDROP images only, none twice; and the database's own floor (positions 1–4,
 * movies and BACKDROP assets only, gone with the item).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as itemRoute from '@/app/api/v1/admin/catalog/items/[id]/route';
import * as publishRoute from '@/app/api/v1/admin/catalog/items/[id]/publish/route';
import * as revertRoute from '@/app/api/v1/admin/catalog/items/[id]/revert/route';
import * as itemsRoute from '@/app/api/v1/admin/catalog/items/route';
import { db } from '@/server/db';
import { pgErrorCode, PG } from '@/server/db-errors';
import { getPublic } from '@/server/catalog/read';
import { clearCatalog, makeAsset, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { call, req, signedIn } from '../support/http';

type Auth = Awaited<ReturnType<typeof signedIn>>;
type AdminItem = {
  id: string;
  slug: string;
  version: number;
  fields: { extraBackdropIds: string[]; backdropId: string | null };
  media: { extraBackdrops: unknown[] };
};

let mod: Auth;
beforeEach(async () => {
  await clearCatalog();
  mod = await signedIn(await makeUser({ role: 'MODERATOR' }));
});
const as = (a: Auth) => ({ cookies: a.cookies, headers: a.headers });

async function create(body: Record<string, unknown>) {
  const res = await call(
    itemsRoute.POST,
    req('POST', '/api/v1/admin/catalog/items', { ...as(mod), body }),
  );
  return { res, json: (await res.json()) as { item: AdminItem; errors?: { path: string }[] } };
}
const patch = (id: string, expectedVersion: number, fields: Record<string, unknown>) =>
  call(
    itemRoute.PATCH,
    req('PATCH', `/api/v1/admin/catalog/items/${id}`, {
      ...as(mod),
      body: { expectedVersion, fields },
    }),
    { id },
  );
const post = (handler: Parameters<typeof call>[0], id: string, body: unknown) =>
  call(handler, req('POST', '/x', { ...as(mod), body }), { id });

async function movie(extras: string[]) {
  const poster = await makeAsset('POSTER');
  const main = await makeAsset('BACKDROP');
  const { res, json } = await create({
    kind: 'MOVIE',
    title: 'O Esquilo Viajante',
    runtimeMinutes: 110,
    year: 2020,
    ageRating: 'L',
    genres: ['Aventura'],
    synopsis: 'Um esquilo atravessa o país atrás da última sessão de cinema.',
    posterId: poster.id,
    backdropId: main.id,
    extraBackdropIds: extras,
  });
  expect(res.status).toBe(201);
  return { item: json.item, main };
}

describe('Mais fundos', () => {
  it('a movie keeps up to four more backgrounds in order; the title page gets all five', async () => {
    const extras = await Promise.all([1, 2, 3, 4].map(() => makeAsset('BACKDROP')));
    const { item, main } = await movie(extras.map((a) => a.id));
    expect(item.fields.extraBackdropIds).toEqual(extras.map((a) => a.id));
    expect(item.media.extraBackdrops).toHaveLength(4);

    const pub = await post(publishRoute.POST, item.id, { expectedVersion: item.version });
    expect(pub.status).toBe(200);
    const page = await getPublic('MOVIE', item.slug);
    expect(page!.backdrops).toHaveLength(5);
    expect(page!.backdrops[0]).toEqual(page!.backdrop);
    // in order: main first, then the extras by position
    const paths = (p: { fallback: string }) => p.fallback;
    const assets = await db().mediaAsset.findMany({
      where: { id: { in: [main.id, ...extras.map((a) => a.id)] } },
    });
    const pathOf = (id: string) =>
      (assets.find((a) => a.id === id)!.variants as { path: string; format: string }[]).find(
        (v) => v.format === 'webp',
      )!.path;
    expect(page!.backdrops.map(paths)).toEqual([main.id, ...extras.map((a) => a.id)].map(pathOf));
  });

  it('reorders and removes by save, keeps them in revisions, and revert brings them back', async () => {
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => makeAsset('BACKDROP')));
    const { item } = await movie([a!.id, b!.id, c!.id]);
    const r = await patch(item.id, 1, { extraBackdropIds: [c!.id, a!.id] });
    expect(r.status).toBe(200);
    const saved = ((await r.json()) as { item: AdminItem }).item;
    expect(saved.fields.extraBackdropIds).toEqual([c!.id, a!.id]);
    const log = await db().auditLog.findFirstOrThrow({
      where: { targetId: item.id, action: 'catalog.save' },
    });
    expect(log.metadata).toMatchObject({ fields: ['extraBackdropIds'] });

    // other saves leave them alone
    const other = await patch(item.id, 2, { year: 2019 });
    expect(((await other.json()) as { item: AdminItem }).item.fields.extraBackdropIds).toEqual([
      c!.id,
      a!.id,
    ]);

    const rev = await post(revertRoute.POST, item.id, { expectedVersion: 3, toVersion: 1 });
    expect(rev.status).toBe(200);
    expect(((await rev.json()) as { item: AdminItem }).item.fields.extraBackdropIds).toEqual([
      a!.id,
      b!.id,
      c!.id,
    ]);

    // a revision from before the feature means "none"
    const v1 = await db().catalogRevision.findUniqueOrThrow({
      where: { itemId_version: { itemId: item.id, version: 1 } },
    });
    const { extraBackdropIds: _drop, ...old } = v1.snapshot as Record<string, unknown>;
    await db().catalogRevision.update({ where: { id: v1.id }, data: { snapshot: old as never } });
    const back = await post(revertRoute.POST, item.id, { expectedVersion: 4, toVersion: 1 });
    expect(((await back.json()) as { item: AdminItem }).item.fields.extraBackdropIds).toEqual([]);
  });

  it('refuses series, posters, the same image twice and more than four', async () => {
    const extra = await makeAsset('BACKDROP');
    const series = await create({
      kind: 'SERIES',
      title: 'Série de Fundo',
      runtimeMinutes: 400,
      extraBackdropIds: [extra.id],
    });
    expect(series.res.status).toBe(422);
    expect(series.json.errors?.map((e) => e.path)).toContain('extraBackdropIds');

    const { item, main } = await movie([]);
    const poster = await makeAsset('POSTER');
    expect((await patch(item.id, 1, { extraBackdropIds: [poster.id] })).status).toBe(422);
    expect((await patch(item.id, 1, { extraBackdropIds: [extra.id, extra.id] })).status).toBe(422);
    expect(
      (await patch(item.id, 1, { backdropId: main.id, extraBackdropIds: [main.id] })).status,
    ).toBe(422);
    const five = await Promise.all([1, 2, 3, 4, 5].map(() => makeAsset('BACKDROP')));
    expect((await patch(item.id, 1, { extraBackdropIds: five.map((a) => a.id) })).status).toBe(422);
    expect(await db().catalogItemBackdrop.count()).toBe(0);
  });

  it('the database keeps it to movies, BACKDROP images and positions 1–4', async () => {
    const m = await makeItem({ kind: 'MOVIE' });
    const s = await makeItem({ kind: 'SERIES' });
    const bd = await makeAsset('BACKDROP');
    const poster = await makeAsset('POSTER');
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
        return null;
      } catch (err) {
        return pgErrorCode(err);
      }
    };
    const add = (itemId: string, position: number, assetId: string) =>
      db().catalogItemBackdrop.create({ data: { itemId, position, assetId } });
    expect(await code(add(s.id, 1, bd.id))).toBe(PG.checkViolation);
    expect(await code(add(m.id, 1, poster.id))).toBe(PG.checkViolation);
    expect(await code(add(m.id, 5, bd.id))).toBe(PG.checkViolation);
    expect(await code(add(m.id, 1, bd.id))).toBeNull();
    expect(await code(add(m.id, 2, bd.id))).toBe(PG.uniqueViolation); // the same image twice
    await db().catalogItem.delete({ where: { id: m.id } });
    expect(await db().catalogItemBackdrop.count()).toBe(0);
  });
});
