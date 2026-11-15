/**
 * Publishing helpers (2026-11-15), in the browser against the production build. Wikidata and
 * Wikipedia are the stack's local stand-in (tests/support/wiki-mock.ts, fictional titles):
 *  - "Preencher com o Wikidata" fills a new movie (and "Desfazer" puts the form back), with the
 *    Wikipedia summary beside the synopsis as a reference;
 *  - "Adicionar vários" turns a list into drafts and says how each line went;
 *  - "Criar rascunho" on a viewer suggestion opens a filled draft;
 *  - "Agendar publicação" on a complete draft, then cancelled.
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
