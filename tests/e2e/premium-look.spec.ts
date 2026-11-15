/**
 * Premium look (2026-11-14): film grain over the site, a soft light at the mouse, velvet on the
 * dark panels, quiet labels instead of outlined chips, balanced titles and figures that line up.
 * Screenshots go to test-results/premium-look.
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'test-results/premium-look';
mkdirSync(SHOTS, { recursive: true });

test('grain, velvet, typography and quiet labels', async ({ page }, info) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/');
  const grain = page.locator('.wf-grain');
  await expect(grain).toHaveCSS('position', 'fixed');
  await expect(grain).toHaveCSS('pointer-events', 'none');
  expect(Number(await grain.evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(0.08);
  // the grain never takes a click: the first movie card is still clickable through it
  const card = page.locator('.wf-movie-grid .wf-scard').first();
  await expect(card).toBeVisible();
  const h1 = page.locator('h1').first();
  if (await h1.count()) {
    expect(await h1.evaluate((e) => getComputedStyle(e).textWrap)).toMatch(/balance/);
  }
  const price = page.locator('.wf-movie-grid__price').first();
  if (await price.count()) {
    expect(await price.evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toContain(
      'tabular-nums',
    );
  }
  await page.screenshot({ path: `${SHOTS}/inicio-${info.project.name}.png` });

  // a title page: the sponsor panel wears the velvet
  await card.click();
  const panel = page.locator('.wf-panel').first();
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain(
    '/fx/velvet.png',
  );
  await page.screenshot({ path: `${SHOTS}/titulo-${info.project.name}.png` });

  // a campaign: its facts are a quiet line now, not outlined chips
  await page.goto('/series');
  const facts = page.getByRole('list', { name: 'Detalhes da campanha' }).first();
  if (await facts.count()) {
    await expect(facts.locator('.wf-chip')).toHaveCount(0);
    await expect(facts.locator('.wf-meta__item').first()).toBeVisible();
  }
  await page.screenshot({ path: `${SHOTS}/series-${info.project.name}.png` });
  expect(violations).toEqual([]);
});

test('a soft light follows the mouse (desktop), and is never there with reduced motion', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'a mouse thing');
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  const light = page.locator('.wf-flashlight');
  await expect(light).not.toHaveClass(/is-on/);
  await page.mouse.move(400, 300);
  await page.mouse.move(640, 360, { steps: 6 });
  await expect(light).toHaveClass(/is-on/);
  expect(await light.evaluate((e) => (e as HTMLElement).style.transform)).toContain(
    'translate3d(640px, 360px',
  );
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/lanterna.png` });

  const still = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
  await still.goto('/');
  await expect(still.locator('.wf-flashlight')).toHaveCSS('display', 'none');
  await expect(still.locator('.wf-grain')).toHaveCSS('animation-name', 'none');
});
