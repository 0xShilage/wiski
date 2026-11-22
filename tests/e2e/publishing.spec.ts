/**
 * Publishing helpers (2026-11-15), in the browser against the production build. Wikidata and
 * Wikipedia are the stack's local stand-in (tests/support/wiki-mock.ts, fictional titles):
 *  - "Preencher com o Wikidata" fills a new movie (and "Desfazer" puts the form back), with the
 *    Wikipedia summary beside the synopsis as a reference;
 *  - "Adicionar vários" turns a list into drafts and says how each line went;
 *  - "Criar rascunho" on a viewer suggestion opens a filled draft;
 *  - "Agendar publicação" on a complete draft, then cancelled;
 *  - Ações (2026-11-18): "Já assistiu fora da live?" on a published movie nobody is paying for
 *    takes it off its slot into Assistidos; on a sponsored one the panel says why it can't.
 * Screenshots go to test-results/publishing.
 */
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

const SHOTS = 'test-results/publishing';
mkdirSync(SHOTS, { recursive: true });
test.describe.configure({ mode: 'serial' });

function cspWatch(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

async function asModerator(page: Page) {
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  await signIn(page.context(), mod.token);
  page.on('dialog', (d) => void d.accept());
  return mod;
}

test.afterAll(async () => {
  // the drafts made here (never published): gone, so later specs see the seeded catalog
  await withDb(async (c) => {
    const ids = (
      await c.query<{ id: string }>(
        `SELECT id FROM "CatalogItem" WHERE status = 'DRAFT' AND ("wikidataId" IS NOT NULL OR title IN ('Título Que Não Existe'))`,
      )
    ).rows.map((r) => r.id);
    if (!ids.length) return;
    await c.query(`UPDATE "Suggestion" SET "itemId" = NULL WHERE "itemId" = ANY($1::uuid[])`, [
      ids,
    ]);
    await c.query(`DELETE FROM "CatalogRevision" WHERE "itemId" = ANY($1::uuid[])`, [ids]);
    await c.query(`DELETE FROM "FranchiseEntry" WHERE "franchiseId" = ANY($1::uuid[])`, [ids]);
    await c.query(`DELETE FROM "CatalogItem" WHERE id = ANY($1::uuid[])`, [ids]);
    await c.query(`DELETE FROM "Suggestion" WHERE title = 'Casa das Marés'`);
  });
});

test('a new movie is filled from Wikidata; Desfazer puts the form back', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard is a desktop tool');
  const violations = cspWatch(page);
  await asModerator(page);
  await page.goto('/admin/catalogo');
  await page.getByRole('button', { name: 'Novo filme' }).click();

  const wd = page.getByRole('region', { name: 'Preencher com o Wikidata' });
  await wd.getByRole('textbox', { name: /Nome do filme/ }).fill('lontra astronauta');
  await wd.getByRole('button', { name: 'Buscar' }).click();
  const results = wd.getByRole('list', { name: 'Resultados do Wikidata' });
  await expect(results.getByRole('button')).toHaveCount(2);
  await expect(results.getByRole('button').first()).toContainText('2019');
  await page.screenshot({ path: `${SHOTS}/wikidata-resultados.png` });

  await results.getByRole('button').first().click();
  const editor = page.getByRole('region', { name: 'Editor' });
  await expect(editor.getByRole('textbox', { name: 'Título', exact: true })).toHaveValue(
    'A Lontra Astronauta',
  );
  await expect(editor.getByRole('textbox', { name: 'Título original' })).toHaveValue(
    'The Astronaut Otter',
  );
  await expect(editor.getByRole('textbox', { name: 'Ano' })).toHaveValue('2019');
  await expect(editor.getByRole('textbox', { name: 'Duração (minutos)' })).toHaveValue('112');
  await expect(editor.getByRole('combobox', { name: 'Classificação indicativa' })).toHaveValue(
    'A12',
  );
  await expect(editor.getByRole('textbox', { name: /Gêneros/ })).toHaveValue(
    'Ficção científica, Aventura',
  );
  await expect(editor.getByRole('textbox', { name: 'Direção' })).toHaveValue('Marina Duarte');
  await expect(editor.getByRole('textbox', { name: /Trailer/ })).toHaveValue(
    'https://youtu.be/ptTrailer01',
  );
  // the synopsis stays empty; the Wikipedia summary is only a reference beside it
  await expect(editor.getByRole('textbox', { name: /Sinopse/ })).toHaveValue('');
  const ref = editor.getByRole('complementary', { name: /Resumo da Wikipédia/ });
  await expect(ref).toContainText('uma lontra que sonha em chegar à Lua');
  await expect(ref.getByRole('link', { name: 'Abrir na Wikipédia' })).toHaveAttribute(
    'href',
    'https://pt.wikipedia.org/wiki/A_Lontra_Astronauta',
  );
  await page.screenshot({ path: `${SHOTS}/wikidata-preenchido.png`, fullPage: true });

  await wd.getByRole('button', { name: 'Desfazer' }).click();
  await expect(editor.getByRole('textbox', { name: 'Título', exact: true })).toHaveValue('');
  await expect(ref).toHaveCount(0);

  // fill again and save the draft
  await wd.getByRole('button', { name: 'Buscar' }).click();
  await results.getByRole('button').first().click();
  await editor.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rascunho criado.' })).toBeVisible();
  const saved = await withDb((c) =>
    c.query(
      `SELECT "wikidataId", "runtimeMinutes" FROM "CatalogItem" WHERE "wikidataId" = 'Q900001'`,
    ),
  );
  expect(saved.rows).toEqual([{ wikidataId: 'Q900001', runtimeMinutes: 112 }]);
  expect(violations).toEqual([]);
});

test('Adicionar vários: a list becomes drafts, each line says how it went', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard is a desktop tool');
  const violations = cspWatch(page);
  await asModerator(page);
  await page.goto('/admin/catalogo');
  await page.getByRole('button', { name: 'Adicionar vários' }).click();
  const bulk = page.getByRole('region', { name: /Adicionar vários/ });
  await bulk
    .getByRole('textbox', { name: /Títulos/ })
    .fill(
      [
        'A Lontra Astronauta (2024)',
        'A Lontra Astronauta (2019)',
        'O Esquilo Sem Dados',
        'Título Que Não Existe, 2001',
      ].join('\n'),
    );
  await expect(bulk.getByText('4 / 20')).toBeVisible();
  await bulk.getByRole('button', { name: 'Criar 4 rascunhos' }).click();
  const rows = bulk.getByRole('list', { name: 'Resultado' }).getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(bulk.getByRole('status').filter({ hasText: 'rascunhos criados' })).toContainText(
    '3 rascunhos criados',
    { timeout: 20_000 },
  );
  await expect(rows.nth(0)).toContainText('Confira: classificação');
  await expect(rows.nth(1)).toContainText('Já está no catálogo'); // saved by the test above
  await expect(rows.nth(2)).toContainText('duração (120 min provisório)');
  await expect(rows.nth(3)).toContainText('não encontrado no Wikidata');
  await page.screenshot({ path: `${SHOTS}/adicionar-varios.png` });

  // "Abrir" goes to the draft
  await rows.nth(0).getByRole('button', { name: 'Abrir' }).click();
  await expect(
    page.getByRole('region', { name: 'Editor' }).getByRole('textbox', { name: 'Ano' }),
  ).toHaveValue('2024');
  expect(violations).toEqual([]);
});

test('Criar rascunho on a viewer suggestion opens a filled draft', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard is a desktop tool');
  const violations = cspWatch(page);
  await asModerator(page);
  const viewer = await seedUser();
  await withDb((c) =>
    c.query(
      `INSERT INTO "Suggestion"(id, "userId", kind, title, "titleKey", note) VALUES ($1, $2, 'SERIES', 'Casa das Marés', 'casa das mares', 'Muito boa!')`,
      [randomUUID(), viewer.id],
    ),
  );
  await page.goto('/admin/sugestoes');
  const card = page.getByRole('listitem').filter({ hasText: 'Casa das Marés' });
  await card.getByRole('button', { name: 'Criar rascunho' }).click();
  await expect(card.getByText(/Rascunho criado e preenchido pelo Wikidata/)).toBeVisible();
  const open = card.getByRole('link', { name: 'Abrir rascunho' });
  await expect(open).toBeVisible();
  await expect(card.getByRole('button', { name: 'Criar rascunho' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/sugestao-rascunho.png` });
  await open.click();
  const editor = page.getByRole('region', { name: 'Editor' });
  await expect(editor.getByRole('textbox', { name: 'Título', exact: true })).toHaveValue(
    'Casa das Marés',
  );
  await expect(editor.getByRole('textbox', { name: /Nº de temporadas/ })).toHaveValue('3');
  expect(violations).toEqual([]);
});

test('Agendar publicação on a complete draft, then cancel it', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard is a desktop tool');
  const violations = cspWatch(page);
  await asModerator(page);
  // the movie saved by the first test, completed with a seeded poster and background
  const id = await withDb(async (c) => {
    const r = await c.query<{ id: string }>(
      `UPDATE "CatalogItem" d SET synopsis = 'Uma lontra sonha com a Lua.',
         "posterId" = s."posterId", "backdropId" = s."backdropId"
       FROM (SELECT "posterId", "backdropId" FROM "CatalogItem"
             WHERE status = 'ACTIVE' AND kind = 'MOVIE' AND "posterId" IS NOT NULL AND "backdropId" IS NOT NULL LIMIT 1) s
       WHERE d."wikidataId" = 'Q900001' AND d.status = 'DRAFT' RETURNING d.id`,
    );
    return r.rows[0]!.id;
  });
  await page.goto(`/admin/catalogo?tipo=filmes&item=${id}`);
  // in the editor's Ações panel (2026-11-18), it opens in place
  const acts = page.getByRole('region', { name: 'Ações' });
  await expect(acts).toContainText('Rascunho: ainda não está no site');
  await acts.locator('summary', { hasText: 'Agendar publicação' }).click();
  const sched = page.getByRole('region', { name: 'Agendar publicação' });
  const at = new Date(Date.now() + 2 * 86_400_000 - 3 * 3_600_000);
  const local = `${at.toISOString().slice(0, 10)}T20:30`;
  await sched.getByLabel('Dia e hora (Brasília)').fill(local);
  await sched.getByRole('button', { name: 'Agendar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Publicação agendada.' })).toBeVisible();
  await expect(sched).toContainText('Entra no ar sozinho');
  await expect(sched).toContainText('20:30');
  await expect(page.getByText('· agendado')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/agendado.png`, fullPage: true });
  const row = await withDb((c) =>
    c.query<{ publishAt: Date }>(`SELECT "publishAt" FROM "CatalogItem" WHERE id = $1`, [id]),
  );
  expect(row.rows[0]!.publishAt.toISOString()).toBe(new Date(`${local}:00-03:00`).toISOString());

  await sched.getByRole('button', { name: 'Cancelar agendamento' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Agendamento cancelado.' }),
  ).toBeVisible();
  await expect(sched.getByLabel('Dia e hora (Brasília)')).toBeVisible();
  expect(violations).toEqual([]);
});

test('Ações: a published movie goes to Assistidos as watched off stream; a sponsored one says why not', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard is a desktop tool');
  const violations = cspWatch(page);
  await asModerator(page);
  // a copy of a seeded movie, published in a free slot, nobody paying for it
  const title = `Fora da vaga ${Date.now().toString(36)}`;
  const id = await withDb(async (c) => {
    const free = await c.query<{ n: number }>(
      `SELECT n FROM generate_series(1, 50) n WHERE n NOT IN
         (SELECT slot FROM "CatalogItem" WHERE kind = 'MOVIE' AND slot IS NOT NULL) ORDER BY n DESC LIMIT 1`,
    );
    const r = await c.query<{ id: string }>(
      `INSERT INTO "CatalogItem"
       SELECT (jsonb_populate_record(NULL::"CatalogItem", to_jsonb(i) || jsonb_build_object(
         'id', gen_random_uuid(), 'slug', $1::text, 'title', $2::text, 'slot', $3::int,
         'status', 'ACTIVE', 'publishedAt', now() - interval '3 days', 'version', 1,
         'reservedUntil', NULL, 'reservedOrderId', NULL, 'wikidataId', NULL, 'offStream', false,
         'watchedAt', NULL, 'publishAt', NULL))).*
       FROM "CatalogItem" i WHERE i.status = 'ACTIVE' AND i.kind = 'MOVIE' LIMIT 1
       RETURNING id`,
      [title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, free.rows[0]!.n],
    );
    return r.rows[0]!.id;
  });
  try {
    await page.goto(`/admin/catalogo?tipo=filmes&item=${id}`);
    const acts = page.getByRole('region', { name: 'Ações' });
    await expect(acts).toContainText('No ar · vaga');
    await acts.locator('summary', { hasText: 'Já assistiu fora da live?' }).click();
    const fora = page.getByRole('region', { name: 'Já assistiu fora da live?' });
    await expect(fora).toContainText('Tira o filme da vaga');
    await page.screenshot({ path: `${SHOTS}/acoes-no-ar.png` });
    await fora.getByRole('button', { name: 'Registrar como assistido' }).click();
    await expect(
      acts.getByRole('status').filter({ hasText: 'Registrado em Assistidos (fora da live).' }),
    ).toBeVisible();
    const row = await withDb((c) =>
      c.query<{ status: string; slot: number | null; offStream: boolean }>(
        `SELECT status, slot, "offStream" FROM "CatalogItem" WHERE id = $1`,
        [id],
      ),
    );
    expect(row.rows[0]).toEqual({ status: 'WATCHED', slot: null, offStream: true });
    await page.goto('/assistidos?tipo=fora-da-live');
    await expect(page.locator('.wf-seen__card', { hasText: title })).toHaveCount(1);

    // a sponsored movie: the row is there, with the reason instead of the form
    const sponsored = await withDb((c) =>
      c.query<{ id: string }>(
        `SELECT id FROM "CatalogItem" WHERE status = 'SPONSORED' AND kind = 'MOVIE' LIMIT 1`,
      ),
    );
    if (sponsored.rows[0]) {
      await page.goto(`/admin/catalogo?tipo=filmes&item=${sponsored.rows[0].id}`);
      const a2 = page.getByRole('region', { name: 'Ações' });
      await expect(a2).toContainText('Já assistiu fora da live?');
      await expect(a2).toContainText(
        'Já foi patrocinado: marque como assistido quando passar na live.',
      );
      await expect(a2.locator('summary', { hasText: 'Já assistiu fora da live?' })).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/acoes-patrocinado.png` });
    }
    expect(violations).toEqual([]);
  } finally {
    // out of later specs' way (archived, like any title taken off the site)
    await withDb((c) =>
      c.query(`UPDATE "CatalogItem" SET status = 'ARCHIVED', "archivedAt" = now() WHERE id = $1`, [
        id,
      ]),
    );
  }
});

test('Admin › Assistidos: a watched title moves between "Visto em live" and "Visto fora da live"', async ({
  page,
}, info) => {
  const violations = cspWatch(page);
  await asModerator(page);
  // a watched copy of a seeded movie (archived, out of the live limit), on the live side
  const title = `Troca etiqueta ${info.project.name} ${Date.now().toString(36)}`;
  const id = await withDb(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO "CatalogItem"
       SELECT (jsonb_populate_record(NULL::"CatalogItem", to_jsonb(i) || jsonb_build_object(
         'id', gen_random_uuid(), 'slug', $1::text, 'title', $2::text, 'slot', NULL,
         'status', 'ARCHIVED', 'archivedAt', now(), 'watchedAt', now() - interval '2 days',
         'publishedAt', now() - interval '9 days', 'version', 1, 'offStream', false,
         'reservedUntil', NULL, 'reservedOrderId', NULL, 'wikidataId', NULL, 'publishAt', NULL)
       )).*
       FROM "CatalogItem" i WHERE i.kind = 'MOVIE' AND i.status IN ('WATCHED', 'ARCHIVED') LIMIT 1
       RETURNING id`,
      [title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title],
    );
    return r.rows[0]!.id;
  });
  const tag = async () =>
    (
      await withDb((c) =>
        c.query<{ offStream: boolean }>(`SELECT "offStream" FROM "CatalogItem" WHERE id = $1`, [
          id,
        ]),
      )
    ).rows[0]!.offStream;
  try {
    await page.goto(`/admin/assistidos?tag=em-live&q=${encodeURIComponent(title)}`);
    const row = page.locator('.wf-watched-row', { hasText: title });
    const place = row.getByRole('group', { name: `Onde “${title}” foi visto` });
    await expect(place.getByRole('radio', { name: 'Visto em live' })).toBeChecked();
    await place.getByRole('radio', { name: 'Visto fora da live' }).check();
    await expect(row.getByRole('status')).toHaveText('Agora: visto fora da live.');
    expect(await tag()).toBe(true);
    await page.screenshot({ path: `${SHOTS}/assistidos-etiqueta-${info.project.name}.png` });
    // it is now on the "fora da live" side
    await page.goto(`/admin/assistidos?tag=fora-da-live&q=${encodeURIComponent(title)}`);
    await expect(
      page
        .locator('.wf-watched-row', { hasText: title })
        .getByRole('radio', { name: 'Visto fora da live' }),
    ).toBeChecked();
    // and back
    await page
      .locator('.wf-watched-row', { hasText: title })
      .getByRole('radio', { name: 'Visto em live' })
      .check();
    await expect(
      page.locator('.wf-watched-row', { hasText: title }).getByRole('status'),
    ).toHaveText('Agora: visto em live.');
    expect(await tag()).toBe(false);
    if (info.project.name === 'mobile-360') {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        360,
      );
    }
    expect(violations).toEqual([]);
  } finally {
    // out of later specs' way: no longer a watched title
    await withDb((c) =>
      c.query(`UPDATE "CatalogItem" SET "watchedAt" = NULL, "offStream" = false WHERE id = $1`, [
        id,
      ]),
    );
  }
});
