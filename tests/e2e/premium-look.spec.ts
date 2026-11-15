/**
 * Premium look (2026-11-14): quiet labels instead of outlined chips, balanced titles and figures
 * that line up. The film grain, the mouse light and the velvet texture were taken out
 * (2026-11-15): none of them may come back unnoticed.
 * Screenshots go to test-results/premium-look.
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'test-results/premium-look';
mkdirSync(SHOTS, { recursive: true });

test('typography and quiet labels; no grain, no mouse light, no velvet', async ({ page }, info) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('.wf-grain, .wf-flashlight')).toHaveCount(0);
  await page.mouse.move(400, 300);
  await page.mouse.move(640, 360, { steps: 6 });
  await expect(page.locator('.wf-flashlight')).toHaveCount(0);
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

  // a title page: the sponsor panel and the footer are plain again (no texture)
  await card.click();
  const panel = page.locator('.wf-panel').first();
  await expect(panel).toBeVisible();
  await page.waitForTimeout(1_200); // the poster morph and the page's fade-in
  // the poster's glow is never cut off in a straight line at the bottom of the title (2026-11-15)
  expect(
    await page.locator('.wf-detail').evaluate((e) => {
      const st = getComputedStyle(e);
      return [st.overflowX, st.overflowY];
    }),
  ).toEqual(['clip', 'visible']);
  for (const el of [panel, page.locator('.wf-footer').first()]) {
    expect(await el.evaluate((e) => getComputedStyle(e).backgroundImage)).not.toContain('/fx/');
  }
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
