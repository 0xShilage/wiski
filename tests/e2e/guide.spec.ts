/**
 * Guia de Winden (2026-11-11): the spoiler-free Dark guide. Screenshots go to test-results/guide.
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'test-results/guide';
mkdirSync(SHOTS, { recursive: true });

test('guia de Winden: only what has been shown, era by era', async ({ page }, info) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to|Hydration|did not match/i.test(m.text()))
      problems.push(m.text());
  });
  await page.goto('/guias/dark');
  await expect(page.getByRole('heading', { name: 'Guia de Winden', level: 1 })).toBeVisible();
  const eps = page.getByRole('radiogroup');
  await expect(eps.getByRole('radio', { name: 'Episódio 1', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // episode 1: only 2019, no hotel, no stranger, no other era named anywhere
  const tabs = page.getByRole('tablist', { name: 'Época' });
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(tabs.getByRole('tab', { name: '2019' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Mais coisas aparecem conforme você assiste.')).toBeVisible();
  const map = page.getByRole('group', { name: 'Mapa ilustrado de Winden em 2019' });
  await expect(map.locator('[data-place="hotel"]')).toHaveCount(0);
  await expect(page.getByText('O forasteiro')).toHaveCount(0);
  expect(await page.locator('main').innerText()).not.toMatch(/1986|1953/);

  // a place opens its panel with who appears there
  await map.locator('[data-place="escola"]').click();
  const panel = page.locator('.wf-guide__panel');
  await expect(panel.getByRole('heading', { name: 'Escola de Winden' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Jonas Kahnwald' })).toBeVisible();
  // a person lights up their places
  await page.getByRole('button', { name: /^Jonas Kahnwald Adolescente/ }).click();
  await expect(map.locator('[data-place="casa-kahnwald"]')).toHaveClass(/is-lit/);

  await page.screenshot({ path: `${SHOTS}/guide-ep1-${info.project.name}.png`, fullPage: true });

  // episode 3: 1986 opens
  await eps.getByRole('radio', { name: 'Episódio 3', exact: true }).click();
  await expect(page).toHaveURL(/\?ep=3$/);
  await tabs.getByRole('tab', { name: '1986' }).click();
  const map86 = page.getByRole('group', { name: 'Mapa ilustrado de Winden em 1986' });
  await expect(map86.locator('[data-place="usina"]')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Nielsen' })).toContainText('Mads Nielsen');

  // the choice is remembered in this browser
  await page.goto('/guias/dark');
  await expect(eps.getByRole('radio', { name: 'Episódio 3', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // a link with ?ep=8: the building site of 1953
  await page.goto('/guias/dark?ep=8');
  await tabs.getByRole('tab', { name: '1953' }).click();
  const map53 = page.getByRole('group', { name: 'Mapa ilustrado de Winden em 1953' });
  await map53.locator('[data-place="usina"]').click();
  await expect(panel).toContainText('canteiro de obras');
  await expect(map53.locator('.wf-winden__site')).toHaveCount(1);
  // going back hides it again
  await eps.getByRole('radio', { name: 'Episódio 2', exact: true }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.goto('/guias/dark?ep=10');
  await tabs.getByRole('tab', { name: '1986' }).click();
  await page.screenshot({ path: `${SHOTS}/guide-ep10-${info.project.name}.png`, fullPage: true });
  expect(problems).toEqual([]);
});
