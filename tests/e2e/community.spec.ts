/**
 * Phase 6 end to end: the progress block on the home page, the Links page from the dev seed,
 * a viewer's suggestion reaching the moderation (and the decision coming back), the streamer's
 * link editor, and the phone "Mais" menu.
 */
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

test.describe.configure({ mode: 'serial' });

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
  const links = page.locator('.wf-links__btn');
  await expect(links).toHaveCount(4);
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

test('phone: the bar has five tabs + "Mais", which opens Avaliações, Sugestões and Links', async ({
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
  await expect(menu.getByRole('link')).toHaveText(['Avaliações', 'Sugestões', 'Links']);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await more.click();
  await menu.getByRole('link', { name: 'Links' }).click();
  await expect(page).toHaveURL(/\/links$/);
  await expect(menu).toBeHidden();
  await expect(bar.getByRole('button', { name: /você está em Links/ })).toBeVisible();
});
