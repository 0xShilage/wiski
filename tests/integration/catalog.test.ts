/**
 * Catalog services + admin API (11 §4, §8; 12 §2 step 6 "done when"): create/save with versions,
 * concurrent-save conflict, revert restores the exact snapshot, publish completeness, the 50-movie
 * limit (409), slot board, Substituir, Assistido, campaigns (streamer + step-up), public reads,
 * and audit rows that carry field NAMES only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as openRoute from '@/app/api/v1/admin/campaigns/[id]/open/route';
import * as extendRoute from '@/app/api/v1/admin/campaigns/[id]/extend/route';
import * as goalRoute from '@/app/api/v1/admin/campaigns/[id]/goal/route';
import * as itemRoute from '@/app/api/v1/admin/catalog/items/[id]/route';
import * as publishRoute from '@/app/api/v1/admin/catalog/items/[id]/publish/route';
import * as replaceRoute from '@/app/api/v1/admin/catalog/items/[id]/replace/route';
import * as revertRoute from '@/app/api/v1/admin/catalog/items/[id]/revert/route';
import * as revisionsRoute from '@/app/api/v1/admin/catalog/items/[id]/revisions/route';
import * as watchedRoute from '@/app/api/v1/admin/catalog/items/[id]/watched/route';
import * as itemsRoute from '@/app/api/v1/admin/catalog/items/route';
import * as slotsRoute from '@/app/api/v1/admin/catalog/slots/route';
import * as campaignPublic from '@/app/api/v1/campaigns/[id]/route';
import * as publicBySlug from '@/app/api/v1/catalog/[kind]/[slug]/route';
import * as publicList from '@/app/api/v1/catalog/[kind]/route';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { clearCatalog, makeAsset, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { call, req, signedIn } from '../support/http';

type Auth = Awaited<ReturnType<typeof signedIn>>;
type AdminItem = {
  id: string;
  status: string;
  slot: number | null;
  version: number;
  slug: string;
  fields: Record<string, unknown>;
  missing: { path: string }[];
  priceCents: number | null;
  formulaGoalCents: number | null;
  campaign: { state: string; goalCents: number; deadlineAt: string; extensions: number } | null;
  revisions: { version: number; note: string; editor: string }[];
};

let mod: Auth;
let streamer: Auth;
let streamerUser: Awaited<ReturnType<typeof makeUser>>;

beforeEach(async () => {
  await clearCatalog();
  mod = await signedIn(await makeUser({ role: 'MODERATOR' }));
  streamerUser = await makeUser({ role: 'STREAMER' });
  streamer = await signedIn(streamerUser);
});

const as = (a: Auth) => ({ cookies: a.cookies, headers: a.headers });

async function create(body: Record<string, unknown>, who = mod) {
  const res = await call(
    itemsRoute.POST,
    req('POST', '/api/v1/admin/catalog/items', { ...as(who), body }),
  );
  return { res, item: res.ok ? ((await res.json()) as { item: AdminItem }).item : null };
}
const patch = (id: string, expectedVersion: number, fields: Record<string, unknown>, who = mod) =>
  call(
    itemRoute.PATCH,
    req('PATCH', `/api/v1/admin/catalog/items/${id}`, {
      ...as(who),
      body: { expectedVersion, fields },
    }),
    { id },
  );
const post = (
  handler: Parameters<typeof call>[0],
  path: string,
  id: string,
  body: unknown,
  who = mod,
) =>
  call(handler, req('POST', path, { ...as(who), ...(body === undefined ? {} : { body }) }), { id });

async function completeMovie(title = 'A Noite do Esquilo', runtimeMinutes = 115) {
  const poster = await makeAsset('POSTER');
  const backdrop = await makeAsset('BACKDROP');
  const { item } = await create({
    kind: 'MOVIE',
    title,
    runtimeMinutes,
    year: 2021,
    ageRating: 'A14',
    genres: ['Ficção científica'],
    synopsis: 'Numa cidade onde as luzes nunca se apagam, um esquilo insone descobre um segredo.',
    posterId: poster.id,
    backdropId: backdrop.id,
    trailer: 'https://youtu.be/dQw4w9WgXcQ',
  });
  return item!;
}

describe('create / save / revert', () => {
  it('creates a draft (v1, revision 1), sanitises text, parses the trailer link', async () => {
    const { res, item } = await create({
      kind: 'MOVIE',
      title: '  A‮ Noite​ do Esquilo  ',
      runtimeMinutes: 131,
      synopsis: 'Linha 1\r\n\r\n\r\nLinha\u0007 2',
      genres: ['Comédia', 'comédia', 'Drama'],
      trailer: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
    });
    expect(res.status).toBe(201);
    expect(item).toMatchObject({
      status: 'DRAFT',
      version: 1,
      slug: 'a-noite-do-esquilo',
      priceCents: 2100,
    });
    expect(item!.fields).toMatchObject({
      title: 'A Noite do Esquilo',
      synopsis: 'Linha 1\n\nLinha 2',
      genres: ['Comédia', 'Drama'],
      trailerYoutubeId: 'dQw4w9WgXcQ',
    });
    expect(item!.revisions).toEqual([expect.objectContaining({ version: 1, note: 'create' })]);
    // A second item with the same title gets a distinct slug.
    expect(
      (await create({ kind: 'MOVIE', title: 'A Noite do Esquilo', runtimeMinutes: 90 })).item!.slug,
    ).toBe('a-noite-do-esquilo-2');
  });

  it('rejects bad input with 422 (unknown keys, long synopsis, bad trailer, series fields on a movie)', async () => {
    for (const body of [
      { kind: 'MOVIE', title: 'X', runtimeMinutes: 100, price: 1 },
      { kind: 'MOVIE', title: 'X', runtimeMinutes: 100, synopsis: 'a'.repeat(601) },
      {
        kind: 'MOVIE',
        title: 'X',
        runtimeMinutes: 100,
        trailer: 'https://evil.example/watch?v=dQw4w9WgXcQ',
      },
      { kind: 'MOVIE', title: 'X', runtimeMinutes: 100, seasonCount: 2 },
      { kind: 'MOVIE', title: 'X', runtimeMinutes: 400 },
      { kind: 'MOVIE', title: '​', runtimeMinutes: 100 },
    ]) {
      expect((await create(body)).res.status, JSON.stringify(body)).toBe(422);
    }
    const backdrop = await makeAsset('BACKDROP');
    expect(
      (await create({ kind: 'MOVIE', title: 'X', runtimeMinutes: 100, posterId: backdrop.id })).res
        .status,
    ).toBe(422);
  });

  it('saves bump the version; a stale version → 409 VERSION_CONFLICT (second moderator)', async () => {
    const { item } = await create({ kind: 'MOVIE', title: 'Ameixa Selvagem', runtimeMinutes: 100 });
    const other = await signedIn(await makeUser({ role: 'MODERATOR' }));
    const a = await patch(item!.id, 1, { synopsis: 'Versão da Ana.' });
    expect(a.status).toBe(200);
    const b = await patch(item!.id, 1, { synopsis: 'Versão do Rui.' }, other);
    expect(b.status).toBe(409);
    expect(await b.json()).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: '2' });
    const row = await db().catalogItem.findUniqueOrThrow({ where: { id: item!.id } });
    expect(row).toMatchObject({ version: 2, synopsis: 'Versão da Ana.' });
  });

  it('revert restores the exact snapshot as a new version and keeps history', async () => {
    const poster = await makeAsset('POSTER');
    const { item } = await create({
      kind: 'MOVIE',
      title: 'Lavanda Neon',
      runtimeMinutes: 100,
      synopsis: 'Original.',
      cast: ['Lia Noite'],
      posterId: poster.id,
    });
    const v1 = await db().catalogRevision.findUniqueOrThrow({
      where: { itemId_version: { itemId: item!.id, version: 1 } },
    });
    await patch(item!.id, 1, {
      title: 'Lavanda Neon 2',
      synopsis: 'Mudou.',
      cast: [],
      posterId: null,
      trailer: 'dQw4w9WgXcQ',
    });
    await patch(item!.id, 2, { year: 1999 });
    const res = await post(
      revertRoute.POST,
      `/api/v1/admin/catalog/items/${item!.id}/revert`,
      item!.id,
      {
        expectedVersion: 3,
        toVersion: 1,
      },
    );
    expect(res.status).toBe(200);
    const after = ((await res.json()) as { item: AdminItem }).item;
    expect(after.version).toBe(4);
    const v4 = await db().catalogRevision.findUniqueOrThrow({
      where: { itemId_version: { itemId: item!.id, version: 4 } },
    });
    expect(v4.snapshot).toEqual(v1.snapshot);
    expect(v4.note).toBe('revert:1');
    const hist = await call(
      revisionsRoute.GET,
      req('GET', `/api/v1/admin/catalog/items/${item!.id}/revisions`, as(mod)),
      { id: item!.id },
    );
    expect(
      ((await hist.json()) as { items: { version: number }[] }).items.map((r) => r.version),
    ).toEqual([4, 3, 2, 1]);
    // Audit rows name fields, never values.
    const audit = await db().auditLog.findMany({
      where: { targetId: item!.id },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'catalog.create',
      'catalog.save',
      'catalog.save',
      'catalog.revert',
    ]);
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toContain('Mudou');
    expect(audit[1]!.metadata).toMatchObject({
      fields: expect.arrayContaining(['title', 'synopsis', 'cast']),
    });
  });
});

describe('"Adicionar texto?" (title over the poster)', () => {
  it('defaults on; turning it off is saved, audited by name, public, and reverts like any field', async () => {
    const m = await completeMovie('Pôster Com Título');
    expect(m.fields.posterTitle).toBe(true);
    const off = await patch(m.id, m.version, { posterTitle: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { item: AdminItem }).item.fields.posterTitle).toBe(false);
    const save = await db().auditLog.findFirstOrThrow({
      where: { targetId: m.id, action: 'catalog.save' },
    });
    expect(save.metadata).toMatchObject({ fields: ['posterTitle'] });

    await post(publishRoute.POST, '/x', m.id, { expectedVersion: m.version + 1 });
    const list = await call(publicList.GET, req('GET', '/api/v1/catalog/movies'), {
      kind: 'movies',
    });
    const items = ((await list.json()) as { items: { slug: string; posterTitle: boolean }[] })
      .items;
    expect(items.find((i) => i.slug === m.slug)?.posterTitle).toBe(false);

    // back to version 1 (text on)
    const rev = await post(revertRoute.POST, '/x', m.id, {
      expectedVersion: m.version + 1,
      toVersion: 1,
    });
    expect(rev.status).toBe(200);
    expect(((await rev.json()) as { item: AdminItem }).item.fields.posterTitle).toBe(true);
    expect((await patch(m.id, 99, { posterTitle: 'nao' })).status).toBe(422);
  });

  it('snapshots saved before the field existed still revert (they mean "show the title")', async () => {
    const m = await completeMovie('Pôster Antigo');
    const v1 = await db().catalogRevision.findUniqueOrThrow({
      where: { itemId_version: { itemId: m.id, version: 1 } },
    });
    const { posterTitle: _drop, ...old } = v1.snapshot as Record<string, unknown>;
    await db().catalogRevision.update({
      where: { id: v1.id },
      data: { snapshot: old as Prisma.InputJsonObject },
    });
    await patch(m.id, 1, { posterTitle: false });
    const rev = await post(revertRoute.POST, '/x', m.id, { expectedVersion: 2, toVersion: 1 });
    expect(rev.status).toBe(200);
    expect(((await rev.json()) as { item: AdminItem }).item.fields.posterTitle).toBe(true);
  });
});

describe('publish and limits', () => {
  it('an incomplete movie → 422 INCOMPLETE listing the missing fields', async () => {
    const { item } = await create({ kind: 'MOVIE', title: 'Rascunho', runtimeMinutes: 100 });
    expect(item!.missing.map((m) => m.path)).toEqual(
      expect.arrayContaining(['synopsis', 'ageRating', 'year', 'genres', 'posterId', 'backdropId']),
    );
    const res = await post(publishRoute.POST, '/x', item!.id, { expectedVersion: 1 });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'INCOMPLETE' });
  });

  it('a complete movie goes live in the first free slot and shows up publicly', async () => {
    await makeItem({ status: 'ACTIVE', slot: 1 });
    const m = await completeMovie();
    const res = await post(publishRoute.POST, '/x', m.id, { expectedVersion: m.version });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { item: AdminItem }).item).toMatchObject({
      status: 'ACTIVE',
      slot: 2,
    });
    const list = await call(publicList.GET, req('GET', '/api/v1/catalog/movies'), {
      kind: 'movies',
    });
    expect(list.headers.get('cache-control')).toBe('public, max-age=15');
    const items = (
      (await list.json()) as { items: { slug: string; priceCents: number; state: string }[] }
    ).items;
    expect(items.find((i) => i.slug === m.slug)).toMatchObject({
      priceCents: 2000,
      state: 'ACTIVE',
    });
    const detail = await call(publicBySlug.GET, req('GET', `/api/v1/catalog/movies/${m.slug}`), {
      kind: 'movies',
      slug: m.slug,
    });
    expect(detail.status).toBe(200);
    expect(JSON.stringify(await detail.json())).not.toMatch(/createdById|reservedOrderId|version/);
  });

  it('drafts are invisible to the public API', async () => {
    const m = await completeMovie('Invisível');
    const detail = await call(publicBySlug.GET, req('GET', `/api/v1/catalog/movies/${m.slug}`), {
      kind: 'movies',
      slug: m.slug,
    });
    expect(detail.status).toBe(404);
  });

  it('publishing beyond 50 live movies → 409 CATALOG_FULL; a taken slot → 409 SLOT_TAKEN', async () => {
    for (let slot = 1; slot <= 49; slot++) await makeItem({ status: 'ACTIVE', slot });
    const a = await completeMovie('Cinquenta');
    const taken = await post(publishRoute.POST, '/x', a.id, {
      expectedVersion: a.version,
      slot: 3,
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: 'SLOT_TAKEN' });
    expect((await post(publishRoute.POST, '/x', a.id, { expectedVersion: a.version })).status).toBe(
      200,
    );
    const b = await completeMovie('Cinquenta e um');
    const full = await post(publishRoute.POST, '/x', b.id, { expectedVersion: b.version });
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ code: 'CATALOG_FULL' });
  });

  it('moderators cannot publish a series (the streamer opens the campaign)', async () => {
    const s = await makeItem({ kind: 'SERIES' });
    const res = await post(publishRoute.POST, '/x', s.id, { expectedVersion: s.version });
    expect(res.status).toBe(409);
  });
});

describe('slot board, Substituir, Assistido', () => {
  it('reorders live items atomically; duplicates → 422', async () => {
    const a = await makeItem({ status: 'ACTIVE', slot: 1 });
    const b = await makeItem({ status: 'ACTIVE', slot: 2 });
    const c = await makeItem({ status: 'ACTIVE', slot: 3 });
    const put = (slots: { id: string; slot: number }[]) =>
      call(
        slotsRoute.PUT,
        req('PUT', '/api/v1/admin/catalog/slots', { ...as(mod), body: { kind: 'MOVIE', slots } }),
      );
    const ok = await put([
      { id: a.id, slot: 3 },
      { id: b.id, slot: 1 },
      { id: c.id, slot: 2 },
    ]);
    expect(ok.status).toBe(200);
    const rows = await db().catalogItem.findMany({ where: { id: { in: [a.id, b.id, c.id] } } });
    expect(Object.fromEntries(rows.map((r) => [r.id, r.slot]))).toEqual({
      [a.id]: 3,
      [b.id]: 1,
      [c.id]: 2,
    });
    expect(
      (
        await put([
          { id: a.id, slot: 1 },
          { id: b.id, slot: 1 },
        ])
      ).status,
    ).toBe(422);
    // Moving onto an occupied slot without moving its owner → rolled back at COMMIT.
    const clash = await put([{ id: a.id, slot: 1 }]);
    expect(clash.status).toBe(409);
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: a.id } })).slot).toBe(3);
  });

  it('Substituir archives a watched movie and puts a complete draft into the same slot', async () => {
    const old = await makeItem({ status: 'WATCHED', slot: 7 });
    const next = await completeMovie('Diamante Violeta');
    const res = await post(replaceRoute.POST, '/x', old.id, { replacementId: next.id });
    expect(res.status).toBe(200);
    expect(await db().catalogItem.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      status: 'ARCHIVED',
      slot: null,
    });
    expect(await db().catalogItem.findUniqueOrThrow({ where: { id: next.id } })).toMatchObject({
      status: 'ACTIVE',
      slot: 7,
    });
  });

  it('a sponsored movie cannot be replaced; marking watched creates the watch event', async () => {
    const sp = await makeItem({ status: 'SPONSORED', slot: 2 });
    expect((await post(replaceRoute.POST, '/x', sp.id, { replacementId: null })).status).toBe(409);
    const res = await post(watchedRoute.POST, '/x', sp.id, undefined);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { item: AdminItem }).item).toMatchObject({
      status: 'WATCHED',
      slot: 2,
    });
    expect(await db().watchEvent.count({ where: { itemId: sp.id } })).toBe(1);
  });

  it('only never-published drafts can be deleted', async () => {
    const d = await makeItem();
    const live = await makeItem({ status: 'ACTIVE', slot: 1 });
    const del = (id: string) =>
      call(itemRoute.DELETE, req('DELETE', `/api/v1/admin/catalog/items/${id}`, as(mod)), { id });
    expect((await del(live.id)).status).toBe(409);
    expect((await del(d.id)).status).toBe(204);
    expect(await db().catalogItem.count({ where: { id: d.id } })).toBe(0);
  });
});

describe('campaigns (STREAMER + step-up + passkey)', () => {
  async function preparedSeries() {
    const poster = await makeAsset('POSTER');
    const backdrop = await makeAsset('BACKDROP');
    const { item } = await create({
      kind: 'SERIES',
      title: 'Crônicas do Bosque',
      runtimeMinutes: 1200,
      seasonsLabel: 'Temporadas 1–3',
      seasonCount: 3,
      episodeCount: 24,
      year: 2019,
      ageRating: 'A14',
      genres: ['Fantasia'],
      synopsis: 'Esquilos guardiões.',
      posterId: poster.id,
      backdropId: backdrop.id,
    });
    return item!;
  }

  it('a stale Google login → STEP_UP_REQUIRED (moderator or streamer); the streamer opens with the formula goal', async () => {
    const s = await preparedSeries();
    expect(s.formulaGoalCents).toBe(30000);
    const path = `/api/v1/admin/campaigns/${s.id}/open`;
    const staleMod = await signedIn(
      await makeUser({ role: 'MODERATOR' }),
      new Date(Date.now() - 30 * 60_000),
    );
    const r0 = await post(openRoute.POST, path, s.id, { expectedVersion: s.version }, staleMod);
    expect(await r0.json()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    const stale = await signedIn(streamerUser, new Date(Date.now() - 30 * 60_000));
    const r1 = await post(openRoute.POST, path, s.id, { expectedVersion: s.version }, stale);
    expect(r1.status).toBe(401);
    expect(await r1.json()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    const r2 = await post(openRoute.POST, path, s.id, { expectedVersion: s.version }, streamer);
    expect(r2.status).toBe(201);
    const opened = ((await r2.json()) as { item: AdminItem }).item;
    expect(opened).toMatchObject({
      status: 'ACTIVE',
      slot: 1,
      campaign: { state: 'OPEN', goalCents: 30000 },
    });
    const days = (Date.parse(opened.campaign!.deadlineAt) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    // Public progress endpoint.
    const c = await db().campaign.findUniqueOrThrow({ where: { itemId: s.id } });
    const pub = await call(campaignPublic.GET, req('GET', `/api/v1/campaigns/${c.id}`), {
      id: c.id,
    });
    expect(pub.headers.get('cache-control')).toBe('public, max-age=5');
    expect(await pub.json()).toMatchObject({
      campaign: { goalCents: 30000, raisedCents: 0, state: 'OPEN' },
    });
  });

  it('extend and lower the goal (never below raised + reserved; exactly raised → Meta atingida)', async () => {
    const s = await preparedSeries();
    await post(
      openRoute.POST,
      '/x',
      s.id,
      { expectedVersion: s.version, goalCents: 20000, days: 10 },
      streamer,
    );
    const ext = await post(extendRoute.POST, '/x', s.id, { days: 7 }, streamer);
    expect(ext.status).toBe(200);
    expect(((await ext.json()) as { item: AdminItem }).item.campaign).toMatchObject({
      extensions: 1,
    });
    // Money arrives (Phase 2 will do this through contributions).
    await db().campaign.update({
      where: { itemId: s.id },
      data: { raisedCents: 12000, reservedCents: 1000, remainingCents: 7000 },
    });
    const tooLow = await post(goalRoute.POST, '/x', s.id, { goalCents: 12000 }, streamer);
    expect(tooLow.status).toBe(409);
    expect(await tooLow.json()).toMatchObject({ code: 'GOAL_BELOW_RAISED', minGoalCents: '13000' });
    await db().campaign.update({
      where: { itemId: s.id },
      data: { reservedCents: 0, remainingCents: 8000 },
    });
    const done = await post(goalRoute.POST, '/x', s.id, { goalCents: 12000 }, streamer);
    expect(done.status).toBe(200);
    expect(((await done.json()) as { item: AdminItem }).item).toMatchObject({
      status: 'FUNDED',
      campaign: { state: 'FUNDED', goalCents: 12000 },
    });
    const campaignId = (await db().campaign.findUniqueOrThrow({ where: { itemId: s.id } })).id;
    const audit = await db().auditLog.findMany({
      where: { action: { startsWith: 'campaign.' }, targetId: campaignId },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'campaign.open',
      'campaign.extend',
      'campaign.goal',
    ]);
  });
});
