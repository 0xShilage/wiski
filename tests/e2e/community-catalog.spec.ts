/**
 * 2026-11-04 end to end: catalog filters and sort on the home grid (kept in the address), a paid
 * movie's "Na fila" card, /ranking from the dev seed, badges on /perfil and the public profile
 * with the opt-out switch, and Admin › Análise for staff.
 */
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

test.describe.configure({ mode: 'serial' });

test('home grid: search, duration and sort narrow the list and stay in the address', async ({
  page,
}) => {
  await page.goto('/');
  const grid = page.getByRole('region', { name: 'Filmes disponíveis' });
  await grid.scrollIntoViewIfNeeded();
  const cards = grid.getByRole('listitem');
  const total = await cards.count();
  expect(total).toBeGreaterThan(3);
  const first = (await cards.first().getByRole('heading').textContent())!.trim();

  const search = grid.getByRole('searchbox');
  await search.fill(first.slice(0, 12));
  await expect(cards.first().getByRole('heading')).toHaveText(first);
  expect(await cards.count()).toBeLessThan(total);
  await expect(page).toHaveURL(/[?&]q=/);

  await search.fill('zzz nada assim');
  await expect(cards).toHaveCount(0);
  await expect(grid.getByText('Nenhum filme com esses filtros')).toBeVisible();
  await grid.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(cards).toHaveCount(total);
  await expect(page).not.toHaveURL(/\?/);

  // sort by price: the first card is the cheapest one shown
  await grid.getByLabel('Ordenar por').selectOption('preco-asc');
  await expect(page).toHaveURL(/ordem=preco-asc/);
  const prices = await grid
    .locator('.wf-movie-grid__price')
    .evaluateAll((els) =>
      els.map((e) => Number(e.textContent!.replace(/[^\d,]/g, '').replace(',', '.'))),
    );
  expect(prices).toEqual([...prices].sort((a, b) => a - b));

  // a shared link opens with the same filter
  await page.goto('/?duracao=mais-120');
  await expect(page.getByLabel('Duração')).toHaveValue('mais-120');
});

test('a paid movie shows its place in the queue', async ({ page }) => {
  const slug = await withDb(async (c) => {
    const r = await c.query<{ slug: string }>(
      `SELECT slug FROM "CatalogItem" WHERE kind = 'MOVIE' AND status = 'SPONSORED' LIMIT 1`,
    );
    return r.rows[0]!.slug;
  });
  await page.goto(`/filmes/${slug}`);
  const card = page.locator('.wf-queue-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading')).toHaveText(/Na fila|Agendado|Na live de agora/);
  await expect(card.locator('.wf-queue-card__pos strong')).toHaveText(/^\d+º$/);
  await expect(card.getByRole('link', { name: 'Ver o cronograma' })).toHaveAttribute(
    'href',
    '/cronograma',
  );
});

test('ranking: the seed sponsor is listed, counts only, period switch', async ({ page }) => {
  await page.goto('/ranking');
  await expect(page.getByRole('heading', { level: 1, name: 'Ranking' })).toBeVisible();
  const sponsors = page.getByRole('region', { name: 'Patrocinadores' });
  await expect(sponsors.getByRole('link', { name: '@luana_v' })).toBeVisible();
  await expect(sponsors).not.toContainText('R$');
  await expect(page.getByRole('link', { name: 'Este mês' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('link', { name: 'Desde sempre' }).click();
  await expect(page).toHaveURL(/periodo=geral/);
  await expect(page.getByRole('link', { name: 'Desde sempre' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('region', { name: 'Mais curtidos' })).toBeVisible();
});

test('badges: earned ones on the public profile; the switch hides them', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'one run is enough (data is shared)');
  const v = await seedUser();
  await withDb((c) => c.query(`UPDATE "User" SET "isVip" = true WHERE id = $1`, [v.id]));
  const ctx = await browser.newContext();
  await signIn(ctx, v.token);
  const page = await ctx.newPage();

  await page.goto(`/u/${v.username}`);
  const pub = page.getByRole('region', { name: 'Conquistas' });
  await expect(pub.getByRole('listitem', { name: 'VIP' })).toBeVisible();
  await expect(pub.getByRole('listitem')).toHaveCount(1); // locked ones stay private

  await page.goto('/perfil');
  const mine = page.getByRole('region', { name: /Conquistas/ });
  await expect(mine.getByRole('listitem')).toHaveCount(13);
  await expect(
    mine.getByRole('listitem', { name: /^Primeiro patrocínio — bloqueada/ }),
  ).toBeVisible();
  await mine.getByLabel('Mostrar minhas conquistas no perfil público e no ranking').uncheck();
  await expect(mine.getByRole('status')).toContainText('ficam só aqui');

  await page.goto(`/u/${v.username}`);
  await expect(page.getByRole('heading', { name: 'Conquistas' })).toHaveCount(0);
  await ctx.close();
});

test('analytics: the streamer sees revenue, the chart and the period switch', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard is a desktop tool');
  const st = await seedUser({ role: 'STREAMER', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, st.token);
  const page = await ctx.newPage();
  await page.goto('/admin/analise');
  await expect(page.getByRole('heading', { level: 1, name: 'Análise' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Receita · últimos 30 dias/ })).toBeVisible();
  await expect(page.locator('.wf-analytics__hero-value')).toHaveText(/R\$/);
  const chart = page.getByRole('group', { name: /Receita por dia/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator('.wf-viz__hit')).toHaveCount(30);
  // keyboard focus shows the tooltip inside the chart
  await chart.locator('.wf-viz__hit').last().focus();
  await expect(chart.locator('.wf-viz__tooltip')).toBeVisible();
  await page.getByText('Ver tabela').click();
  await expect(page.locator('.wf-viz__table tbody tr')).toHaveCount(30);
  await expect(
    page.getByRole('region', { name: 'Títulos que mais arrecadaram' }).getByRole('img'),
  ).toBeVisible();
  await page.getByRole('link', { name: '12 meses' }).click();
  await expect(page).toHaveURL(/periodo=365/);
  await expect(page.getByRole('group', { name: /Receita por mês/ })).toBeVisible();
  await ctx.close();
});
