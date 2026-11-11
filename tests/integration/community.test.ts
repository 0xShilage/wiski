/**
 * Phase 6: the Links page (streamer edits, public order), viewer suggestions (signed-in only,
 * staff-only list, compare-and-set decisions, limits, LGPD) and the home page's progress block.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { cleanLinkUrl, platformOf } from '@/lib/links';
import { publicLinks } from '@/server/links/links';
import { watchProgress } from '@/server/catalog/progress';
import { watchedTitles } from '@/server/catalog/read';
import { POST as watchedOffStreamRoute } from '@/app/api/v1/admin/catalog/items/[id]/watched-offstream/route';
import { purgeSuggestions, titleKeyOf } from '@/server/suggestions/suggestions';
import { eraseMyAccount, exportMyData } from '@/server/users/lgpd';
import { GET as linksRoute, POST as linkCreateRoute } from '@/app/api/v1/admin/links/route';
import {
  DELETE as linkDelRoute,
  PATCH as linkPatchRoute,
} from '@/app/api/v1/admin/links/[id]/route';
import { PUT as linkOrderRoute } from '@/app/api/v1/admin/links/order/route';
import { POST as suggestRoute } from '@/app/api/v1/suggestions/route';
import { GET as suggestionsRoute } from '@/app/api/v1/admin/suggestions/route';
import { PATCH as suggestionPatchRoute } from '@/app/api/v1/admin/suggestions/[id]/route';
import { clearCatalog, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { freshIp, signedIn } from '../support/http';
import {
  as,
  fundedCampaign,
  hit,
  makeSession,
  paidMovie,
  resetSlots,
  type Who,
} from '../support/live';

type Link = { id: string; label: string; position: number; visible: boolean; url: string };

describe('links page', () => {
  beforeEach(async () => {
    await db().socialLink.deleteMany({});
  });

  const add = (who: Who, body: Record<string, unknown>) =>
    hit(linkCreateRoute, 'POST', '/api/v1/admin/links', { who, body });

  it('streamer adds, edits, hides, reorders and deletes; positions stay 1…n; audited', async () => {
    const st = await as('STREAMER');
    const a = await add(st, { label: 'Twitch', url: 'twitch.tv/wiski' });
    expect(a.res.status).toBe(201);
    expect(a.json).toMatchObject({
      url: 'https://twitch.tv/wiski',
      platform: 'Twitch',
      position: 1,
    });
    const b = await add(st, {
      label: '  YouTube  ',
      url: 'https://www.youtube.com/@wiski',
      note: 'Cortes',
    });
    const c = await add(st, { label: 'Site', url: 'https://exemplo.com.br/' });
    expect([b.json.position, c.json.position]).toEqual([2, 3]);
    expect(b.json.label).toBe('YouTube');

    // edit + hide
    const ed = await hit(linkPatchRoute, 'PATCH', '', {
      who: st,
      params: { id: c.json.id as string },
      body: { label: 'Meu site', visible: false },
    });
    expect(ed.json).toMatchObject({ label: 'Meu site', visible: false });
    expect((await publicLinks()).map((l) => l.label)).toEqual(['Twitch', 'YouTube']);

    // reorder: every id exactly once
    const ids = [c.json.id, a.json.id, b.json.id] as string[];
    const re = await hit(linkOrderRoute, 'PUT', '', { who: st, body: { ids } });
    expect((re.json.links as Link[]).map((l) => l.id)).toEqual(ids);
    const partial = await hit(linkOrderRoute, 'PUT', '', { who: st, body: { ids: ids.slice(1) } });
    expect(partial.res.status).toBe(409);
    expect(partial.json.code).toBe('LINKS_CHANGED');

    // delete closes the gap
    expect(
      (await hit(linkDelRoute, 'DELETE', '', { who: st, params: { id: ids[1]! } })).res.status,
    ).toBe(204);
    const list = (await hit(linksRoute, 'GET', '', { who: st })).json.links as Link[];
    expect(list.map((l) => [l.id, l.position])).toEqual([
      [ids[0], 1],
      [ids[2], 2],
    ]);

    const actions = await db().auditLog.findMany({
      where: { action: { startsWith: 'link.' }, actorId: st.user.id },
      select: { action: true, metadata: true },
    });
    expect(actions.map((x) => x.action).sort()).toEqual([
      'link.create',
      'link.create',
      'link.create',
      'link.delete',
      'link.reorder',
      'link.update',
    ]);
    expect(JSON.stringify(actions)).not.toContain('twitch.tv'); // field names, never values
  });

  it('refuses unsafe or useless addresses; caps the page at 30 (moderators edit it too)', async () => {
    const st = await as('STREAMER');
    for (const url of [
      'http://twitch.tv/wiski',
      // eslint-disable-next-line no-script-url -- hostile input under test
      'javascript:alert(1)',
      'data:text/html,oi',
      'https://user:pw@twitch.tv/',
      'https://localhost/',
      'https://192.168.0.1/',
      'https://twitch.tv:8443/x',
      'https://twitch.tv/a b',
      'ftp://exemplo.com/',
    ]) {
      const r = await add(st, { label: 'X', url });
      expect(r.res.status, url).toBe(422);
    }
    expect((await add(st, { label: '', url: 'https://a.example' })).res.status).toBe(422);
    expect((await add(st, { label: 'x'.repeat(41), url: 'https://a.example' })).res.status).toBe(
      422,
    );
    for (let i = 0; i < 30; i++) {
      expect((await add(st, { label: `L${i}`, url: `https://a.example/${i}` })).res.status).toBe(
        201,
      );
    }
    const full = await add(st, { label: 'Mais um', url: 'https://a.example/31' });
    expect(full.res.status).toBe(409);
    expect(full.json.code).toBe('LINKS_FULL');
    // a moderator reaches the same list (and its cap)
    expect(
      (await add(await as('MODERATOR'), { label: 'M', url: 'https://a.example' })).json.code,
    ).toBe('LINKS_FULL');
  });

  it('url helpers: platform names, IDN to punycode', () => {
    expect(platformOf('https://m.youtube.com/@x')).toBe('YouTube');
    expect(platformOf('https://twitter.com/x')).toBe('X');
    expect(platformOf('https://nottwitch.tv/x')).toBeNull();
    expect(cleanLinkUrl('https://café.example/menu')).toBe('https://xn--caf-dma.example/menu');
    expect(cleanLinkUrl('  instagram.com/wiski ')).toBe('https://instagram.com/wiski');
  });
});

describe('suggestions', () => {
  beforeEach(async () => {
    await db().suggestion.deleteMany({});
  });

  const suggest = (who: Who | null, body: Record<string, unknown>, ip = freshIp()) =>
    hit(suggestRoute, 'POST', '/api/v1/suggestions', { who, body, ip });

  it('signed-in viewers suggest; text is sanitised; the same title twice → 409; anonymous → 401', async () => {
    const v = await as('USER');
    expect((await suggest(null, { kind: 'MOVIE', title: 'Duna' })).res.status).toBe(401);
    const r = await suggest(v, {
      kind: 'MOVIE',
      title: '  Duna:‮ Parte Dois ',
      year: 2024,
      note: 'Muito​ bom',
    });
    expect(r.res.status).toBe(201);
    expect((r.json.mine as { title: string; status: string }[])[0]).toMatchObject({
      title: 'Duna: Parte Dois',
      status: 'NEW',
    });
    const row = await db().suggestion.findFirstOrThrow({ where: { userId: v.user.id } });
    expect(row).toMatchObject({ titleKey: 'duna parte dois', note: 'Muito bom', year: 2024 });
    const dup = await suggest(v, { kind: 'MOVIE', title: 'DUNA — parte dois' });
    expect(dup.res.status).toBe(409);
    expect(dup.json.code).toBe('SUGGESTION_DUPLICATE');
    expect((await suggest(v, { kind: 'MOVIE', title: '   ' })).res.status).toBe(422);
    expect((await suggest(v, { kind: 'MOVIE', title: 'x'.repeat(121) })).res.status).toBe(422);
    expect((await suggest(v, { kind: 'MOVIE', title: 'Ok', year: 1700 })).res.status).toBe(422);
  });

  it('5 a day per account; at most 10 waiting; suspended and not-yet-onboarded viewers refused', async () => {
    const v = await as('USER');
    const s: number[] = [];
    for (let i = 0; i < 6; i++)
      s.push((await suggest(v, { kind: 'SERIES', title: `Série ${i}` })).res.status);
    expect(s).toEqual([201, 201, 201, 201, 201, 429]);

    const many = await makeUser();
    for (let i = 0; i < 10; i++) {
      await db().suggestion.create({
        data: { userId: many.id, kind: 'MOVIE', title: `F${i}`, titleKey: `f${i}` },
      });
    }
    const w = { user: many, auth: await signedIn(many) };
    const r = await suggest(w, { kind: 'MOVIE', title: 'Mais um' });
    expect(r.json.code).toBe('SUGGESTION_LIMIT');

    const sus = await makeUser({ status: 'SUSPENDED' });
    await db().user.update({
      where: { id: sus.id },
      data: { suspendedUntil: new Date(Date.now() + 86_400_000) },
    });
    expect(
      (await suggest({ user: sus, auth: await signedIn(sus) }, { kind: 'MOVIE', title: 'X' })).json
        .code,
    ).toBe('ACCOUNT_SUSPENDED');
    const fresh = await makeUser({ username: null });
    expect(
      (await suggest({ user: fresh, auth: await signedIn(fresh) }, { kind: 'MOVIE', title: 'X' }))
        .json.code,
    ).toBe('ONBOARDING_REQUIRED');
  });

  it('staff list groups the same title; decisions are compare-and-set and audited; viewers get 404', async () => {
    const a = await as('USER');
    const b = await as('USER');
    await suggest(a, { kind: 'MOVIE', title: 'Interestelar' });
    await suggest(b, { kind: 'MOVIE', title: 'interestelar!' });
    await suggest(b, { kind: 'FRANCHISE', title: 'Matrix', note: 'Todos os filmes' });

    expect((await hit(suggestionsRoute, 'GET', '', { who: a })).res.status).toBe(404);
    const mod = await as('MODERATOR');
    const list = await hit(suggestionsRoute, 'GET', '/api/v1/admin/suggestions', { who: mod });
    const rows = list.json.suggestions as {
      id: string;
      title: string;
      alsoSuggested: number;
      author: string;
      status: string;
    }[];
    expect(list.json.waiting).toBe(3);
    expect(rows.filter((r) => r.title.toLowerCase().startsWith('interestelar'))).toHaveLength(2);
    expect(rows.find((r) => r.title === 'Interestelar')!.alsoSuggested).toBe(1);
    expect(rows.find((r) => r.title === 'Matrix')).toMatchObject({
      alsoSuggested: 0,
      author: b.user.username,
    });

    const target = rows.find((r) => r.title === 'Matrix')!;
    const ok = await hit(suggestionPatchRoute, 'PATCH', '', {
      who: mod,
      params: { id: target.id },
      body: { status: 'ACCEPTED', expectedStatus: 'NEW' },
    });
    expect(ok.res.status).toBe(200);
    // a second moderator who still saw NEW
    const late = await hit(suggestionPatchRoute, 'PATCH', '', {
      who: await as('STREAMER'),
      params: { id: target.id },
      body: { status: 'DISMISSED', expectedStatus: 'NEW' },
    });
    expect(late.res.status).toBe(409);
    expect(late.json.code).toBe('SUGGESTION_CHANGED');
    const row = await db().suggestion.findUniqueOrThrow({ where: { id: target.id } });
    expect(row).toMatchObject({ status: 'ACCEPTED', reviewedById: mod.user.id });
    expect(
      await db().auditLog.count({
        where: { action: 'suggestion.status', targetId: target.id },
      }),
    ).toBe(1);

    // reopen clears the decision
    await hit(suggestionPatchRoute, 'PATCH', '', {
      who: mod,
      params: { id: target.id },
      body: { status: 'NEW', expectedStatus: 'ACCEPTED' },
    });
    expect(await db().suggestion.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
      status: 'NEW',
      reviewedAt: null,
      reviewedById: null,
    });
    const accepted = await hit(
      suggestionsRoute,
      'GET',
      '/api/v1/admin/suggestions?status=ACCEPTED',
      {
        who: mod,
      },
    );
    expect(accepted.json.suggestions).toEqual([]);
  });

  it('a moderator can mark a suggestion "Já assistido"', async () => {
    const mod = await as('MODERATOR');
    const v = await as('USER');
    await suggest(v, { kind: 'MOVIE', title: 'Carros 2' });
    const rows = (await hit(suggestionsRoute, 'GET', '/api/v1/admin/suggestions', { who: mod }))
      .json.suggestions as { id: string; title: string }[];
    const target = rows.find((r) => r.title === 'Carros 2')!;
    const r = await hit(suggestionPatchRoute, 'PATCH', '', {
      who: mod,
      params: { id: target.id },
      body: { status: 'WATCHED', expectedStatus: 'NEW' },
    });
    expect(r.res.status).toBe(200);
    expect(await db().suggestion.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
      status: 'WATCHED',
      reviewedById: mod.user.id,
    });
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'suggestion.status', targetId: target.id },
    });
    expect(log.metadata).toMatchObject({ to: 'WATCHED' });
    const watched = await hit(suggestionsRoute, 'GET', '/api/v1/admin/suggestions?status=WATCHED', {
      who: mod,
    });
    expect((watched.json.suggestions as { title: string }[]).map((s) => s.title)).toContain(
      'Carros 2',
    );
  });

  it('LGPD: export lists them, erase deletes them, decided ones go after 12 months', async () => {
    const v = await as('USER');
    await suggest(v, { kind: 'MOVIE', title: 'Coraline' });
    const data = await exportMyData(v.user, null);
    expect(data.suggestions).toEqual([
      expect.objectContaining({ title: 'Coraline', status: 'NEW' }),
    ]);
    await eraseMyAccount(v.user, v.user.username!, null);
    expect(await db().suggestion.count({ where: { userId: v.user.id } })).toBe(0);

    const u = await makeUser();
    const mod = await makeUser({ role: 'MODERATOR' });
    const old = new Date(Date.now() - 400 * 86_400_000);
    await db().suggestion.create({
      data: {
        userId: u.id,
        kind: 'MOVIE',
        title: 'Velha',
        titleKey: 'velha',
        status: 'DISMISSED',
        createdAt: old,
        reviewedAt: old,
        reviewedById: mod.id,
      },
    });
    await db().suggestion.create({
      data: {
        userId: u.id,
        kind: 'MOVIE',
        title: 'Esperando',
        titleKey: 'esperando',
        createdAt: old,
      },
    });
    expect(await purgeSuggestions()).toBe(1);
    expect(
      (await db().suggestion.findMany({ where: { userId: u.id } })).map((s) => s.title),
    ).toEqual(['Esperando']);
  });

  it('title keys', () => {
    expect(titleKeyOf('O Senhor dos Anéis: A Sociedade do Anel')).toBe(
      'o senhor dos aneis a sociedade do anel',
    );
    expect(titleKeyOf('  Amélie!!  ')).toBe('amelie');
    expect(titleKeyOf('千と千尋の神隠し')).toBe('千と千尋の神隠し');
    expect(titleKeyOf('!!!')).toBe('');
  });
});

describe('progress block', () => {
  beforeEach(async () => {
    await clearCatalog();
    resetSlots();
  });

  it('watched (archived too), runtime minutes and the queue, split by kind', async () => {
    const empty = await watchProgress();
    expect(empty).toEqual({
      watched: { total: 0, byKind: { MOVIE: 0, SERIES: 0, FRANCHISE: 0, ANIME: 0 } },
      minutes: { total: 0, byKind: { MOVIE: 0, SERIES: 0, FRANCHISE: 0, ANIME: 0 } },
      queued: { total: 0, byKind: { MOVIE: 0, SERIES: 0, FRANCHISE: 0, ANIME: 0 } },
    });
    await makeItem({ kind: 'MOVIE', status: 'WATCHED', slot: 1, runtimeMinutes: 120 });
    const archived = await makeItem({ kind: 'MOVIE', status: 'ARCHIVED', runtimeMinutes: 90 });
    await db().catalogItem.update({ where: { id: archived.id }, data: { watchedAt: new Date() } });
    await makeItem({ kind: 'SERIES', status: 'WATCHED', slot: 1, runtimeMinutes: 600 });
    await makeItem({ kind: 'MOVIE', status: 'ARCHIVED', runtimeMinutes: 100 }); // never watched
    await paidMovie();
    const scheduled = await paidMovie();
    const live = await makeSession();
    await db().order.update({
      where: { id: scheduled.order.id },
      data: { status: 'SCHEDULED', sessionId: live.id, scheduledAt: new Date() },
    });
    await fundedCampaign();

    expect(await watchProgress()).toEqual({
      watched: { total: 3, byKind: { MOVIE: 2, SERIES: 1, FRANCHISE: 0, ANIME: 0 } },
      minutes: { total: 810, byKind: { MOVIE: 210, SERIES: 600, FRANCHISE: 0, ANIME: 0 } },
      queued: { total: 3, byKind: { MOVIE: 2, SERIES: 1, FRANCHISE: 0, ANIME: 0 } },
    });
    // leave no planned live behind for the other suites
    await clearCatalog();
    await db().streamSession.delete({ where: { id: live.id } });
  });
});

describe('off-stream watched (2026-11-10)', () => {
  beforeEach(async () => {
    await clearCatalog();
    resetSlots();
  });

  it('registers a draft Iara watched by herself: it reaches Assistidos but not the live progress', async () => {
    const mod = await as('MODERATOR');
    const draft = await makeItem({
      kind: 'MOVIE',
      status: 'DRAFT',
      title: 'Carros 2',
      runtimeMinutes: 106,
    });
    const r = await hit(watchedOffStreamRoute, 'POST', '', {
      who: mod,
      params: { id: draft.id },
      body: { expectedVersion: draft.version, watchedOn: '2026-10-20' },
    });
    expect(r.res.status).toBe(200);
    const row = await db().catalogItem.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row).toMatchObject({ status: 'WATCHED', offStream: true });
    expect(row.watchedAt).not.toBeNull();
    expect(row.slot).toBeNull();
    // shows in Assistidos, tagged "fora da live"
    const seen = await watchedTitles(undefined, null);
    expect(seen.find((t) => t.id === draft.id)).toMatchObject({
      offStream: true,
      title: 'Carros 2',
    });
    // but is kept out of the live progress counts
    expect((await watchProgress()).watched.total).toBe(0);
    // audited
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'catalog.watched', targetId: draft.id },
    });
    expect(log.metadata).toMatchObject({ offStream: true });
    await clearCatalog();
  });

  it('only a draft, and not with a future date', async () => {
    const mod = await as('MODERATOR');
    const active = await makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot: 1 });
    const bad = await hit(watchedOffStreamRoute, 'POST', '', {
      who: mod,
      params: { id: active.id },
      body: { expectedVersion: active.version, watchedOn: null },
    });
    expect(bad.res.status).toBe(409); // INVALID_STATE: not a draft
    const draft = await makeItem({ kind: 'MOVIE', status: 'DRAFT' });
    const future = await hit(watchedOffStreamRoute, 'POST', '', {
      who: mod,
      params: { id: draft.id },
      body: { expectedVersion: draft.version, watchedOn: '2099-01-01' },
    });
    expect(future.res.status).toBe(409); // INVALID_STATE: future date
    await clearCatalog();
  });
});
