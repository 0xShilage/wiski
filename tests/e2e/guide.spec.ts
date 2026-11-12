/**
 * Guia de Winden (2026-11-11): the spoiler-free Dark guide. Screenshots go to test-results/guide.
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { seedUser, signIn, withDb } from './support/seed';

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

test('guia de Winden: spoilers behind a button, and the team adds a character photo', async ({
  page,
  browser,
}, info) => {
  await page.goto('/guias/dark');
  const box = page.getByRole('region', { name: 'Com spoilers' });
  const toggle = box.getByRole('button', { name: 'Mostrar spoilers' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // closed: the revelations are not in the page at all
  expect(await page.content()).not.toContain('Mikkel é Michael');
  await toggle.click();
  await expect(box.getByRole('button', { name: 'Esconder spoilers' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(box.getByRole('heading', { name: 'Mikkel é Michael' })).toBeVisible();
  await box.screenshot({ path: `${SHOTS}/spoilers-${info.project.name}.png` });
  await box.getByRole('button', { name: 'Esconder spoilers' }).click();
  await expect(box.getByRole('heading', { name: 'Mikkel é Michael' })).toHaveCount(0);
  // closed again on the next visit
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Com spoilers' })
      .getByRole('button', { name: 'Mostrar spoilers' }),
  ).toBeVisible();

  // without a photo, a character shows initials
  const card = page.locator('#pessoa-jonas');
  await expect(card.locator('.wf-face--initials')).toHaveText('JK');
  if (!info.project.name.startsWith('desktop')) return;

  // the team uploads a photo for Jonas (2019) from the dashboard
  await withDb((c) => c.query(`DELETE FROM "GuidePortrait" WHERE guide = 'dark'`));
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, mod.token);
  const admin = await ctx.newPage();
  try {
    await admin.goto('/admin/guias');
    await expect(admin.getByRole('heading', { name: 'Guia de Winden', level: 1 })).toBeVisible();
    const photo = await sharp({
      create: { width: 600, height: 800, channels: 3, background: '#4f3d72' },
    })
      .jpeg()
      .toBuffer();
    const slot = admin
      .getByRole('region', { name: /^2019/ })
      .locator('li', { hasText: 'Jonas Kahnwald' });
    await slot.locator('input[type=file]').setInputFiles({
      name: 'jonas.jpg',
      mimeType: 'image/jpeg',
      buffer: photo,
    });
    await expect(admin.getByText('Foto de Jonas Kahnwald salva.')).toBeVisible({ timeout: 20_000 });
    await expect(slot.locator('img')).toHaveCount(1);
    await admin.screenshot({ path: `${SHOTS}/admin-portraits.png`, fullPage: true });

    await page.reload();
    const face = page.locator('#pessoa-jonas .wf-face img');
    await expect(face).toHaveAttribute('alt', 'Foto de Jonas Kahnwald');
    await expect(face).toHaveAttribute('src', /^\/media\/[0-9a-f]{32}-\d+\.webp$/);
    await page.locator('#pessoa-jonas button').click();
    await expect(page.locator('.wf-guide__panel .wf-face img')).toHaveCount(1);
    await page.screenshot({
      path: `${SHOTS}/guide-photo-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await withDb((c) => c.query(`DELETE FROM "GuidePortrait" WHERE guide = 'dark'`));
    await ctx.close();
  }
});
