/**
 * Film (2026-11-14): "Fita quebrada" on the error pages (the strip runs, burns, snaps; still with
 * reduced motion) and "Carregamento em quadros" (film frames while a list page renders). Title
 * pages keep their real 404 (no loading boundary above them). Screenshots go to
 * test-results/film.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'test-results/film';
mkdirSync(SHOTS, { recursive: true });

function cspWatch(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

test('404: the film runs through the gate, burns through the code and snaps in two', async ({
  page,
}, info) => {
  const violations = cspWatch(page);
  const res = await page.goto('/um-endereco-que-nao-existe');
  expect(res?.status()).toBe(404);
  const film = page.locator('.wf-oops svg.wf-fb');
  await expect(film).toBeVisible();
  await expect(film).toHaveAttribute('aria-hidden', 'true');
  await expect(film.locator('.wf-fb__code').first()).toHaveText('404');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Esse título saiu da fila…');

  const art = page.locator('.wf-oops__art');
  if (info.project.name === 'desktop-1280') {
    await page.waitForTimeout(500);
    await art.screenshot({ path: `${SHOTS}/404-1-rodando.png` });
    await page.waitForTimeout(1300);
    await art.screenshot({ path: `${SHOTS}/404-2-queimando.png` });
  }
  // after the snap: the whole strip gives way to the two hanging halves
  await expect(film.locator('.wf-fb__whole')).toHaveCSS('visibility', 'hidden', {
    timeout: 5_000,
  });
  await page.waitForTimeout(900);
  const left = await film
    .locator('.wf-fb__half--left')
    .evaluate((e) => getComputedStyle(e).transform);
  expect(left).not.toBe('none');
  await art.screenshot({ path: `${SHOTS}/404-3-quebrada-${info.project.name}.png` });
  // the strip runs off both sides of the screen without making the page scroll sideways
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/404-pagina-${info.project.name}.png` });
  expect(violations).toEqual([]);
});

test('reduced motion: the broken film is drawn still, straight away', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'once is enough');
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/outro-endereco-que-nao-existe');
  const film = page.locator('svg.wf-fb');
  await expect(film.locator('.wf-fb__whole')).toHaveCSS('visibility', 'hidden');
  await expect(film.locator('.wf-fb__half--right')).toHaveCSS('visibility', 'visible');
  expect(
    await film
      .locator('.wf-fb__run')
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe('none');
  await ctx.close();
});

test('a title page that does not exist still answers 404 (no loading boundary above it)', async ({
  page,
}) => {
  const res = await page.goto('/filmes/um-filme-que-nao-existe');
  expect(res?.status()).toBe(404);
  await expect(page.locator('svg.wf-fb')).toBeVisible();
});

test('film frames stand in while the next page renders, then go', async ({ page }, info) => {
  const violations = cspWatch(page);
  await page.goto('/links');
  const nav = page.getByRole('navigation', {
    name: info.project.name === 'desktop-1280' ? 'Principal' : 'Principal (celular)',
  });
  const frames = page.locator('.wf-route-loader .wf-reel__frame');

  // a fast page: nothing flashes
  await nav.getByRole('link', { name: 'Cronograma' }).click();
  await expect(page).toHaveURL(/\/cronograma$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.wf-route-loader')).toHaveCount(0);

  // a slow one: the server's answer is held a moment, the frames cover the old page meanwhile
  let held = false;
  await page.route(
    (url) => url.pathname === '/series',
    async (route) => {
      held = true;
      await new Promise((r) => setTimeout(r, 2_000));
      await route.continue();
    },
  );
  await nav.getByRole('link', { name: 'Séries' }).click();
  await expect(frames.first()).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Carregando a página…' })).toBeAttached();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/carregando-${info.project.name}.png` });
  await expect(page).toHaveURL(/\/series$/);
  await expect(page.locator('.wf-route-loader')).toHaveCount(0);
  expect(held).toBe(true);

  // back to the page it left from: no frames come back
  await page.goBack();
  await expect(page).toHaveURL(/\/cronograma$/);
  await page.waitForTimeout(500);
  await expect(page.locator('.wf-route-loader')).toHaveCount(0);
  expect(violations).toEqual([]);
});

test('the inline strip stands in while a panel loads', async ({ page }) => {
  // the order page fetches its order after the first paint
  await page.route('**/api/v1/orders/**', async (route) => {
    await new Promise((r) => setTimeout(r, 1_500));
    await route.continue();
  });
  await page.goto('/pedido/WF-ZZZZZZ');
  const loader = page.getByRole('status').filter({ hasText: 'Carregando pedido…' });
  await expect(loader).toBeVisible();
  await expect(loader.locator('.wf-reel__frame')).toHaveCount(3);
});
