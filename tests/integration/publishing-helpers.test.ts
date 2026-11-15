/**
 * Publishing helpers (2026-11-15): "Preencher com o Wikidata" (search, then one title's fields
 * and the Wikipedia summary), "Adicionar vários" (one title → a filled draft; already in the
 * catalog → 409; Wikidata down → the title alone), "Criar rascunho" on a viewer suggestion (every
 * viewer who asked is answered, idempotent, games refused) and "Agendar publicação" (complete
 * movie drafts only, between 2 minutes and 90 days ahead; the worker publishes on time, falls
 * back to a free slot, and unschedules with the reason when it can't). And the database's floor.
 * Wikidata itself is a local fixture server (tests/support/wiki-mock.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as lookupRoute from '@/app/api/v1/admin/catalog/lookup/route';
import * as quickRoute from '@/app/api/v1/admin/catalog/quick-add/route';
import * as itemsRoute from '@/app/api/v1/admin/catalog/items/route';
import * as itemRoute from '@/app/api/v1/admin/catalog/items/[id]/route';
import * as scheduleRoute from '@/app/api/v1/admin/catalog/items/[id]/schedule/route';
import * as draftRoute from '@/app/api/v1/admin/suggestions/[id]/draft/route';
import { db } from '@/server/db';
import { PG, pgErrorCode } from '@/server/db-errors';
import { resetEnvCache } from '@/server/env';
import { publishScheduled } from '@/server/catalog/publishing';
import { listSuggestions } from '@/server/suggestions/suggestions';
import { clearCatalog, makeAsset, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { call, req, signedIn } from '../support/http';
import { startWikiMock, type WikiMock } from '../support/wiki-mock';

let wiki: WikiMock;
beforeAll(async () => {
  wiki = await startWikiMock();
  process.env.WIKI_TEST_ORIGIN = wiki.origin;
  resetEnvCache();
});
afterAll(async () => {
  delete process.env.WIKI_TEST_ORIGIN;
  resetEnvCache();
  await wiki.close();
});

type Auth = Awaited<ReturnType<typeof signedIn>>;
let mod: Auth;
let modId: string;
beforeEach(async () => {
  wiki.setDown(false);
  await db().suggestion.deleteMany({});
  await clearCatalog();
  const u = await makeUser({ role: 'MODERATOR' });
  modId = u.id;
  mod = await signedIn(u);
});
const as = () => ({ cookies: mod.cookies, headers: mod.headers });

async function lookup(params: Record<string, string>) {
  const res = await call(
    lookupRoute.GET,
    req('GET', `/api/v1/admin/catalog/lookup?${new URLSearchParams(params)}`, as()),
  );
  return { res, json: (await res.json()) as Record<string, unknown> };
}
async function quick(body: Record<string, unknown>) {
  const res = await call(
    quickRoute.POST,
    req('POST', '/api/v1/admin/catalog/quick-add', { ...as(), body }),
  );
  return {
    res,
    json: (await res.json()) as {
      result: { itemId: string; title: string; wikidataId: string | null; missing: string[] };
      code?: string;
      detail?: string;
    },
  };
}

describe('Preencher com o Wikidata', () => {
  it('searches only the kind asked for, accents optional, and names itself to Wikidata', async () => {
    const { res, json } = await lookup({ kind: 'MOVIE', q: 'lontra astronauta' });
    expect(res.status).toBe(200);
    const results = json.results as { id: string; title: string; year: number | null }[];
    expect(results.map((r) => [r.id, r.year])).toEqual([
      ['Q900001', 2019],
      ['Q900002', 2024],
    ]);
    // a series search doesn't list films
    expect(((await lookup({ kind: 'SERIES', q: 'lontra' })).json.results as unknown[]).length).toBe(
      0,
    );
    expect(wiki.requests.at(-1)?.userAgent).toMatch(/^Wiskiflix\/1\.0 \(http/);
  });

  it('one title: the fields and the Wikipedia summary as a reference', async () => {
    const { res, json } = await lookup({ kind: 'MOVIE', id: 'Q900001' });
    expect(res.status).toBe(200);
    const fill = json.fill as {
      fields: Record<string, unknown>;
      summary: { text: string; url: string };
      url: string;
    };
    expect(fill.fields).toMatchObject({
      title: 'A Lontra Astronauta',
      year: 2019,
      runtimeMinutes: 112,
      ageRating: 'A12',
      trailer: 'ptTrailer01',
    });
    expect(fill.summary.text).toMatch(/^A Lontra Astronauta é um filme/);
    expect(fill.summary.url).toBe('https://pt.wikipedia.org/wiki/A_Lontra_Astronauta');
    expect(fill.url).toBe('https://www.wikidata.org/wiki/Q900001');
  });

  it('a bad id, an unknown one and Wikidata down are clean problems', async () => {
    expect((await lookup({ kind: 'MOVIE', id: 'https://evil.example' })).res.status).toBe(422);
    expect((await lookup({ kind: 'MOVIE', id: 'Q999999' })).res.status).toBe(404);
    expect((await lookup({ kind: 'MOVIE', q: 'a', id: 'Q1' })).res.status).toBe(422);
    wiki.setDown(true);
    const down = await lookup({ kind: 'MOVIE', q: 'lontra' });
    expect(down.res.status).toBe(502);
    expect(down.json.code).toBe('WIKIDATA_UNAVAILABLE');
  });

  it('the editor saves the Wikidata id with the draft (and only a Q-id)', async () => {
    const create = (wikidataId: string) =>
      call(
        itemsRoute.POST,
        req('POST', '/api/v1/admin/catalog/items', {
          ...as(),
          body: { kind: 'MOVIE', title: 'A Lontra Astronauta', runtimeMinutes: 112, wikidataId },
        }),
      );
    const ok = await create('Q900001');
    expect(ok.status).toBe(201);
    const { item } = (await ok.json()) as { item: { id: string; fields: { wikidataId: string } } };
    expect(item.fields.wikidataId).toBe('Q900001');
    expect((await create('Q0')).status).toBe(422);
    const log = await db().auditLog.findFirst({
      where: { action: 'catalog.create', targetId: item.id },
    });
    expect(log?.metadata).toMatchObject({ source: 'wikidata' });
  });
});

describe('Adicionar vários', () => {
  it('a title becomes a filled draft; the year picks the right version', async () => {
    const { res, json } = await quick({ kind: 'MOVIE', title: 'A Lontra Astronauta', year: 2024 });
    expect(res.status).toBe(201);
    expect(json.result).toMatchObject({ wikidataId: 'Q900002', title: 'A Lontra Astronauta' });
    const row = await db().catalogItem.findUniqueOrThrow({ where: { id: json.result.itemId } });
    expect(row).toMatchObject({
      status: 'DRAFT',
      year: 2024,
      runtimeMinutes: 98,
      wikidataId: 'Q900002',
    });
    expect(json.result.missing).toEqual(['classificação']);

    const full = await quick({ kind: 'MOVIE', title: 'a lontra astronauta', year: 2019 });
    const film = await db().catalogItem.findUniqueOrThrow({
      where: { id: full.json.result.itemId },
    });
    expect(film).toMatchObject({
      title: 'A Lontra Astronauta',
      originalTitle: 'The Astronaut Otter',
      year: 2019,
      runtimeMinutes: 112,
      ageRating: 'A12',
      genres: ['Ficção científica', 'Aventura'],
      director: 'Marina Duarte',
      trailerYoutubeId: 'ptTrailer01',
      synopsis: '',
      posterId: null,
    });
    expect(film.cast).toHaveLength(6);
    const rev = await db().catalogRevision.findFirst({ where: { itemId: film.id } });
    expect(rev?.version).toBe(1);
  });

  it('already in the catalog (same Wikidata item, or same title) → 409, nothing made', async () => {
    await quick({ kind: 'MOVIE', title: 'A Lontra Astronauta', year: 2019 });
    const again = await quick({ kind: 'MOVIE', title: 'A Lontra Astronauta', year: 2019 });
    expect(again.res.status).toBe(409);
    expect(again.json.code).toBe('ALREADY_IN_CATALOG');
    await makeItem({ title: 'Um Filme à Mão', status: 'DRAFT' });
    expect((await quick({ kind: 'MOVIE', title: 'um filme a mao' })).res.status).toBe(409);
    expect(await db().catalogItem.count()).toBe(2);
  });

  it('a series and a franchise fill their own fields', async () => {
    const s = await quick({ kind: 'SERIES', title: 'Casa das Marés' });
    expect(
      await db().catalogItem.findUniqueOrThrow({ where: { id: s.json.result.itemId } }),
    ).toMatchObject({
      seasonCount: 3,
      episodeCount: 24,
      seasonsLabel: 'Temporadas 1–3',
      runtimeMinutes: 1080,
    });
    const f = await quick({ kind: 'FRANCHISE', title: 'Saga do Farol' });
    const entries = await db().franchiseEntry.findMany({
      where: { franchiseId: f.json.result.itemId },
      orderBy: { position: 'asc' },
    });
    expect(entries.map((e) => [e.title, e.runtimeMinutes])).toEqual([
      ['O Farol', 120],
      ['O Farol 2: A Volta', 130],
    ]);
    expect(
      (await db().catalogItem.findUniqueOrThrow({ where: { id: f.json.result.itemId } }))
        .runtimeMinutes,
    ).toBe(250);
  });

  it('not found or Wikidata down: the draft keeps the title, and says so', async () => {
    const none = await quick({ kind: 'MOVIE', title: 'Título Que Não Existe', year: 2001 });
    expect(none.res.status).toBe(201);
    expect(none.json.result.wikidataId).toBeNull();
    expect(none.json.result.missing[0]).toMatch(/não encontrado/);
    wiki.setDown(true);
    const down = await quick({ kind: 'MOVIE', title: 'Outro Título' });
    expect(down.res.status).toBe(201);
    expect(down.json.result.missing[0]).toMatch(/fora do ar/);
    const row = await db().catalogItem.findUniqueOrThrow({
      where: { id: down.json.result.itemId },
    });
    expect(row).toMatchObject({ title: 'Outro Título', runtimeMinutes: 120, wikidataId: null });
  });
});

describe('Criar rascunho (sugestões)', () => {
  async function suggest(
    title: string,
    kind: 'MOVIE' | 'GAME' = 'MOVIE',
    year: number | null = null,
  ) {
    const u = await makeUser();
    return db().suggestion.create({
      data: {
        userId: u.id,
        kind,
        title,
        titleKey: title
          .normalize('NFKD')
          .replace(/\p{M}/gu, '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim(),
        year,
      },
    });
  }
  const draft = (id: string) =>
    call(draftRoute.POST, req('POST', '/x', { ...as(), body: {} }), { id });

  it('makes the draft, answers every viewer who asked, and is idempotent', async () => {
    const a = await suggest('A Lontra Astronauta', 'MOVIE', 2019);
    const b = await suggest('a lontra astronauta');
    const other = await suggest('Casa das Marés');
    const res = await draft(a.id);
    expect(res.status).toBe(200);
    const { result } = (await res.json()) as {
      result: { itemId: string; existed: boolean; linked: number };
    };
    expect(result).toMatchObject({ existed: false, linked: 2 });
    const rows = await db().suggestion.findMany({ where: { id: { in: [a.id, b.id, other.id] } } });
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(a.id)).toMatchObject({
      status: 'ACCEPTED',
      itemId: result.itemId,
      reviewedById: modId,
    });
    expect(by(b.id)).toMatchObject({ status: 'ACCEPTED', itemId: result.itemId });
    expect(by(other.id)).toMatchObject({ status: 'NEW', itemId: null });
    // the board shows the draft to open
    const page = await listSuggestions({ status: 'ACCEPTED' });
    expect(page.suggestions.find((s) => s.id === a.id)?.item).toMatchObject({
      id: result.itemId,
      status: 'DRAFT',
    });
    // again: the same draft, nothing new
    const again = (await (await draft(a.id)).json()) as {
      result: { itemId: string; existed: boolean };
    };
    expect(again.result).toMatchObject({ itemId: result.itemId, existed: true });
    expect(await db().catalogItem.count()).toBe(1);
    const log = await db().auditLog.findFirst({
      where: { action: 'suggestion.draft', targetId: a.id },
    });
    expect(log?.metadata).toEqual({ itemId: result.itemId, existed: false, suggestions: 2 });
  });

  it('a title already in the catalog is linked, not duplicated; a game is refused', async () => {
    const item = await makeItem({ title: 'Casa das Marés', kind: 'MOVIE' });
    const s = await suggest('Casa das Marés');
    const res = (await (await draft(s.id)).json()) as {
      result: { itemId: string; existed: boolean };
    };
    expect(res.result).toMatchObject({ itemId: item.id, existed: true });
    const game = await suggest('Jogo Qualquer', 'GAME');
    const g = await draft(game.id);
    expect(g.status).toBe(409);
    expect(((await g.json()) as { code: string }).code).toBe('NOT_A_CATALOG_KIND');
  });
});

describe('Agendar publicação', () => {
  async function completeMovie(slot: number | null = null) {
    const poster = await makeAsset('POSTER');
    const backdrop = await makeAsset('BACKDROP');
    const m = await makeItem({ title: `Filme Agendado ${Math.random()}`, slot });
    return db().catalogItem.update({
      where: { id: m.id },
      data: {
        year: 2020,
        ageRating: 'A12',
        genres: ['Drama'],
        posterId: poster.id,
        backdropId: backdrop.id,
        version: 1,
      },
    });
  }
  const put = (id: string, body: unknown) =>
    call(scheduleRoute.PUT, req('PUT', '/x', { ...as(), body }), { id });
  const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

  it('only complete movie drafts, 2 minutes to 90 days ahead; cancel with null', async () => {
    const m = await completeMovie();
    expect((await put(m.id, { expectedVersion: 1, publishAt: inMin(0.5) })).status).toBe(422);
    expect((await put(m.id, { expectedVersion: 1, publishAt: inMin(91 * 1440) })).status).toBe(422);
    expect((await put(m.id, { expectedVersion: 0, publishAt: inMin(60) })).status).toBe(409);
    const ok = await put(m.id, { expectedVersion: 1, publishAt: inMin(60) });
    expect(ok.status).toBe(200);
    const { item } = (await ok.json()) as { item: { publishAt: string; version: number } };
    expect(Date.parse(item.publishAt)).toBeGreaterThan(Date.now() + 59 * 60_000);
    expect(item.version).toBe(1); // scheduling isn't an edit
    expect((await put(m.id, { expectedVersion: 1, publishAt: null })).status).toBe(200);
    expect(
      (await db().catalogItem.findUniqueOrThrow({ where: { id: m.id } })).publishAt,
    ).toBeNull();

    const bare = await makeItem({ title: 'Sem Pôster' });
    const inc = await put(bare.id, { expectedVersion: 0, publishAt: inMin(60) });
    expect(inc.status).toBe(422);
    expect(((await inc.json()) as { code: string }).code).toBe('INCOMPLETE');
    const series = await makeItem({ kind: 'SERIES' });
    expect((await put(series.id, { expectedVersion: 0, publishAt: inMin(60) })).status).toBe(409);
    const logs = await db().auditLog.count({
      where: { action: 'catalog.schedule', targetId: m.id },
    });
    expect(logs).toBe(2);
  });

  it('the worker publishes on time, in its planned slot or the first free one', async () => {
    const a = await completeMovie(3);
    const b = await completeMovie(3); // planned the same slot
    const later = await completeMovie();
    const soon = new Date(Date.now() + 5 * 60_000);
    await db().catalogItem.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { publishAt: soon },
    });
    await db().catalogItem.update({ where: { id: later.id }, data: { publishAt: inMin(600) } });
    expect(await publishScheduled(new Date())).toBe(0); // not yet
    expect(await publishScheduled(new Date(soon.getTime() + 1000))).toBe(2);
    const rows = await db().catalogItem.findMany({ where: { id: { in: [a.id, b.id, later.id] } } });
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(a.id)).toMatchObject({ status: 'ACTIVE', slot: 3, publishAt: null });
    expect(by(b.id)).toMatchObject({ status: 'ACTIVE', slot: 1, publishAt: null });
    expect(by(later.id)).toMatchObject({ status: 'DRAFT' });
    const log = await db().auditLog.findFirst({
      where: { action: 'catalog.publish', targetId: a.id },
    });
    expect(log).toMatchObject({ actorId: null });
    expect(log?.metadata).toMatchObject({ scheduled: true, slot: 3 });
  });

  it('a draft that became incomplete is unscheduled with the reason', async () => {
    const m = await completeMovie();
    await db().catalogItem.update({ where: { id: m.id }, data: { publishAt: inMin(5) } });
    await db().catalogItem.update({ where: { id: m.id }, data: { posterId: null } });
    expect(await publishScheduled(new Date(Date.now() + 10 * 60_000))).toBe(0);
    const row = await db().catalogItem.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ status: 'DRAFT', publishAt: null });
    expect(row.publishError).toMatch(/pôster/i);
    const res = await call(itemRoute.GET, req('GET', '/x', as()), { id: m.id });
    const { item } = (await res.json()) as { item: { publishError: string | null } };
    expect(item.publishError).toBe(row.publishError);
    expect(
      await db().auditLog.findFirst({
        where: { action: 'catalog.scheduleFailed', targetId: m.id },
      }),
    ).toMatchObject({ actorId: null, metadata: { kind: 'MOVIE', code: 'INCOMPLETE' } });
  });
});

describe('the database floor', () => {
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (err) {
      return pgErrorCode(err);
    }
  };
  it('Q-ids only; schedules on movie drafts only; leaving DRAFT clears the schedule', async () => {
    const m = await makeItem();
    expect(
      await code(
        db().catalogItem.update({ where: { id: m.id }, data: { wikidataId: 'https://x' } }),
      ),
    ).toBe(PG.checkViolation);
    const s = await makeItem({ kind: 'SERIES' });
    expect(
      await code(db().catalogItem.update({ where: { id: s.id }, data: { publishAt: new Date() } })),
    ).toBe(PG.checkViolation);
    expect(
      await code(
        db().catalogItem.update({ where: { id: m.id }, data: { publishError: 'x'.repeat(301) } }),
      ),
    ).toBe(PG.checkViolation);
    await db().catalogItem.update({
      where: { id: m.id },
      data: { publishAt: new Date(Date.now() + 3_600_000), publishError: 'antes' },
    });
    // e.g. "Registrar como assistido" straight from the draft
    await db().catalogItem.update({
      where: { id: m.id },
      data: { status: 'WATCHED', watchedAt: new Date(), publishedAt: new Date() },
    });
    expect(await db().catalogItem.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({
      publishAt: null,
      publishError: null,
    });
  });
});
