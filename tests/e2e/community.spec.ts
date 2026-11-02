/**
 * Phase 6 end to end: the progress block on the home page, the Links page from the dev seed,
 * a viewer's suggestion reaching the moderation (and the decision coming back), the streamer's
 * link editor, and the phone "Mais" menu.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { seedUser, signIn, withDb } from './support/seed';

test.describe.configure({ mode: 'serial' });
const DIR = join(process.cwd(), 'test-results', 'fixtures');

test('home: "Nosso progresso" with totals and the per-kind split', async ({ page }) => {
  await page.goto('/');
  const block = page.getByRole('region', { name: 'Nosso progresso' });
  await block.scrollIntoViewIfNeeded();
  await expect(block).toBeVisible();
  for (const label of ['Títulos assistidos', 'Tempo assistido', 'Na fila']) {
    const tile = block.getByRole('article', { name: label });
    await expect(tile).toBeVisible();
    await expect(
      tile.getByRole('list', { name: `${label} por tipo` }).getByRole('listitem'),
    ).toHaveCount(3);
  }
  // the dev seed has watched titles and paid movies waiting
  await expect(
    block.getByRole('article', { name: 'Títulos assistidos' }).locator('.wf-progress-block__value'),
  ).not.toHaveText('0');
  await expect(block.getByRole('article', { name: 'Tempo assistido' })).toContainText(
    /\d (?:h|min)/,
  );
});

test('links: the seeded buttons in order, platform names as text, no new tab', async ({ page }) => {
  await page.goto('/links');
  await expect(page.getByRole('heading', { level: 1, name: 'Links' })).toBeVisible();
  await expect(page.getByText('Onde encontrar a Iara fora daqui.')).toBeVisible();
  const links = page.locator('.wf-links__btn');
  await expect(links).toHaveCount(4);
  // every seeded link is a known platform → its glyph, decorative (hidden from screen readers)
  for (let i = 0; i < 4; i++) {
    const icon = links.nth(i).locator('.wf-links__icon svg');
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    await expect(icon.locator('path')).toHaveCount(1);
  }
  await expect(links.first()).toHaveAccessibleName(/^Twitch/);
  await expect(links.first()).toHaveAttribute('href', 'https://twitch.tv/wiski');
  await expect(links.first()).toContainText('Lives de terça a sábado');
  // the platform name shows only when the button says something else
  await expect(links.first().locator('.wf-links__where')).toHaveCount(0);
  await expect(links.nth(3).locator('.wf-links__where')).toHaveText('Discord');
  await expect(links.first()).not.toHaveAttribute('target', /.+/);
  expect(await links.first().getAttribute('rel')).toContain('noreferrer');
});

test('suggestions: signed out → sign-in link back here', async ({ page }) => {
  await page.goto('/sugestoes');
  await expect(page.getByRole('heading', { level: 1, name: 'Sugestões' })).toBeVisible();
  const signInLink = page.getByRole('link', { name: 'Entrar com Google' });
  await expect(signInLink).toHaveAttribute('href', /returnTo=%2Fsugestoes/);
});

test('suggestions: a viewer suggests, a moderator accepts, the viewer sees it', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'one run is enough (data is shared)');
  const viewer = await seedUser();
  const vctx = await browser.newContext();
  await signIn(vctx, viewer.token);
  const page = await vctx.newPage();
  await page.goto('/sugestoes');
  await page.getByRole('radio', { name: 'Série' }).check();
  const title = `Série e2e ${Date.now().toString(36)}`;
  await page.getByLabel('Nome').fill(title);
  await page.getByLabel('Ano (opcional)').fill('2017');
  await page.getByLabel('Por que esse? (opcional)').fill('Vale a maratona.');
  await page.getByRole('button', { name: 'Enviar sugestão' }).click();
  await expect(page.getByRole('status')).toContainText('Sugestão enviada');
  const mine = page.getByRole('region', { name: 'Suas sugestões' });
  await expect(mine.getByRole('listitem').filter({ hasText: title })).toContainText('Esperando');

  // the same title again
  await page.getByLabel('Nome').fill(title.toUpperCase());
  await page.getByRole('button', { name: 'Enviar sugestão' }).click();
  await expect(page.locator('.wf-toast--err')).toContainText('Você já sugeriu este título');

  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const mctx = await browser.newContext();
  await signIn(mctx, mod.token);
  const admin = await mctx.newPage();
  await admin.goto('/admin/sugestoes');
  const card = admin.locator('.wf-ops-card').filter({ hasText: title });
  await expect(card).toContainText(`@${viewer.username}`);
  await expect(card).toContainText('Vale a maratona.');
  await card.getByRole('button', { name: 'Aceitar' }).click();
  await expect(admin.getByRole('status')).toContainText('Sugestão aceita');
  await expect(admin.locator('.wf-ops-card').filter({ hasText: title })).toHaveCount(0);

  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Suas sugestões' })
      .getByRole('listitem')
      .filter({ hasText: title }),
  ).toContainText('Aceita');
  await vctx.close();
  await mctx.close();
});

test('links editor: the streamer adds, moves and hides a link', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard is a desktop tool');
  const st = await seedUser({ role: 'STREAMER', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, st.token);
  const page = await ctx.newPage();
  await page.goto('/admin/links');
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Novo link' }) });
  await form.getByLabel('Nome do botão').fill('Letterboxd');
  await form.getByLabel('Endereço (https://)').fill('https://letterboxd.com/wiski');
  await form.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByRole('status')).toContainText('Link adicionado');
  const list = page.getByRole('list', { name: 'Links, na ordem da página' });
  await expect(list.getByRole('listitem').last()).toContainText('Letterboxd');
  await page.getByRole('button', { name: 'Subir Letterboxd' }).click();
  await expect(page.getByRole('status')).toContainText('Ordem salva');
  await expect(list.getByRole('listitem').nth(3)).toContainText('Letterboxd');
  await list
    .getByRole('listitem')
    .filter({ hasText: 'Letterboxd' })
    .getByRole('button', { name: 'Ocultar' })
    .click();
  await expect(list.getByRole('listitem').filter({ hasText: 'Letterboxd' })).toContainText(
    'Oculto',
  );

  const pub = await ctx.newPage();
  await pub.goto('/links');
  await expect(pub.locator('.wf-links__btn')).toHaveCount(4);
  await expect(pub.getByText('Letterboxd')).toHaveCount(0);

  // put the seed back as it was for the other runs
  await withDb((c) => c.query(`DELETE FROM "SocialLink" WHERE label = 'Letterboxd'`));
  await ctx.close();
});

test('phone: the bar has five tabs + "Mais", which opens Assistidos, Avaliações, Sugestões and Links', async ({
  page,
}, info) => {
  test.skip(!info.project.name.startsWith('mobile'), 'touch only');
  await page.goto('/');
  const bar = page.getByRole('navigation', { name: 'Principal (celular)' });
  await expect(bar.getByRole('link')).toHaveText([
    'Filmes',
    'Séries',
    'Franquias',
    'Cronograma',
    'Perfil',
  ]);
  const more = bar.getByRole('button', { name: /^Mais/ });
  await more.click();
  const menu = page.getByRole('list', { name: 'Mais páginas' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link')).toHaveText([
    'Assistidos',
    'Avaliações',
    'Sugestões',
    'Links',
  ]);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await more.click();
  await menu.getByRole('link', { name: 'Links' }).click();
  await expect(page).toHaveURL(/\/links$/);
  await expect(menu).toBeHidden();
  await expect(bar.getByRole('button', { name: /você está em Links/ })).toBeVisible();
});

test('assistidos: watched titles with posters, filter by kind, cards open the title page', async ({
  page,
}) => {
  await page.goto('/assistidos');
  await expect(page.getByRole('heading', { level: 1, name: 'Assistidos' })).toBeVisible();
  const filter = page.getByRole('navigation', { name: 'Filtrar por tipo' });
  await expect(filter.getByRole('link', { name: 'Todos' })).toHaveAttribute('aria-current', 'page');
  const cards = page.locator('.wf-seen__card');
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).toContainText('Assistido em');
  await expect(cards.first().locator('img')).toHaveAttribute('src', /^\/media\//);
  await filter.getByRole('link', { name: 'Franquias' }).click();
  await expect(page).toHaveURL(/tipo=franquias/);
  await expect(filter.getByRole('link', { name: 'Franquias' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await filter.getByRole('link', { name: 'Filmes' }).click();
  const first = page.locator('.wf-seen__card').first();
  const href = await first.getAttribute('href');
  expect(href).toMatch(/^\/filmes\//);
  await first.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test('cronograma: posters next to the titles and "Próximas temporadas" from the dashboard', async ({
  page,
}) => {
  await page.goto('/cronograma');
  const thumb = page.locator('.wf-cron__thumb img').first();
  await expect(thumb).toHaveAttribute('src', /^\/media\//);
  const panel = page.getByRole('complementary', { name: 'Próximas temporadas' });
  await expect(panel).toBeVisible();
  // the seed: a catalog series (poster + link) and one that is only a name
  await expect(panel.locator('a.wf-rel__row').first()).toHaveAttribute('href', /^\/series\//);
  await expect(panel).toContainText('Temporada 4');
  await expect(panel).toContainText('Bosque Sombrio');
  await expect(panel.locator('div.wf-rel__row')).toContainText('Temporada 2');
});

test('estreias: a moderator adds a release and it shows on the Cronograma', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard is a desktop tool');
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, mod.token);
  const page = await ctx.newPage();
  await page.goto('/admin/estreias');
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Nova estreia' }) });
  const name = `Série E2E ${Date.now().toString(36)}`;
  await form.getByLabel('Nome da série').fill(name);
  await form.getByLabel('Temporada').fill('Temporada 9');
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await form.getByLabel('Data de estreia').fill(soon);
  await form.getByLabel('Observação (opcional)').fill('Netflix');
  await form.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByRole('status')).toContainText('Estreia adicionada');
  await expect(page.locator('.wf-ops-card').filter({ hasText: name })).toContainText('Netflix');

  const pub = await ctx.newPage();
  await pub.goto('/cronograma');
  const panel = pub.getByRole('complementary', { name: 'Próximas temporadas' });
  await expect(panel).toContainText(name);
  await expect(panel).toContainText('Temporada 9');

  await withDb((c) => c.query(`DELETE FROM "SeasonRelease" WHERE title = $1`, [name]));
  await ctx.close();
});

test('estreias: only the year and an own poster; the Cronograma shows "Previsão" and the poster', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard is a desktop tool');
  mkdirSync(DIR, { recursive: true });
  const poster = join(DIR, 'release-poster.jpg');
  const raw = Buffer.alloc(700 * 1050 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 17 + (i >> 8)) & 0xff;
  await sharp(raw, { raw: { width: 700, height: 1050, channels: 3 } })
    .jpeg({ quality: 80 })
    .toFile(poster);

  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, mod.token);
  const page = await ctx.newPage();
  await page.goto('/admin/estreias');
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Nova estreia' }) });
  const name = `Ano E2E ${Date.now().toString(36)}`;
  const year = String(new Date().getFullYear() + 2);
  await form.getByLabel('Nome da série').fill(name);
  await form.getByLabel('Temporada').fill('Temporada 2');
  await form.getByLabel('Só sei o ano').check();
  await expect(form.getByLabel('Data de estreia')).toHaveCount(0);
  await form.getByLabel('Ano previsto').fill(year);
  await form.locator('input[type=file]').setInputFiles(poster);
  await expect(form.locator('.wf-drop--poster img')).toBeVisible({ timeout: 30_000 });
  await form.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByRole('status')).toContainText('Estreia adicionada');
  const card = page.locator('.wf-ops-card').filter({ hasText: name });
  await expect(card).toContainText(`Previsão: ${year}`);
  await expect(card).toContainText('Pôster próprio');

  const pub = await ctx.newPage();
  await pub.goto('/cronograma');
  const row = pub
    .getByRole('complementary', { name: 'Próximas temporadas' })
    .locator('.wf-rel__row')
    .filter({ hasText: name });
  await expect(row).toContainText(`Previsão: ${year}`);
  await expect(row.locator('.wf-rel__thumb img')).toHaveAttribute('src', /^\/media\//);

  await withDb((c) => c.query(`DELETE FROM "SeasonRelease" WHERE title = $1`, [name]));
  await ctx.close();
});
