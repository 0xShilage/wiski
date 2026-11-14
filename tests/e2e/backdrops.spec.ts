/**
 * A movie's backgrounds (2026-11-14): the team adds more backgrounds to a movie in the dashboard
 * ("Mais fundos"), and its page fades from one to the next; with reduced motion it stays on the
 * first. Screenshots go to test-results/backdrops.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { seedUser, signIn, withDb } from './support/seed';

const SHOTS = 'test-results/backdrops';
const DIR = 'test-results/e2e-uploads';
mkdirSync(SHOTS, { recursive: true });
test.describe.configure({ mode: 'serial' });

const TITLE = 'Padrão Infinito';
const SLUG = 'padrao-infinito';

/** A 1920×1080 background: a soft two-colour gradient with a big shape, so the fade is visible. */
async function background(name: string, from: string, to: string) {
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#g)"/>
    <circle cx="1400" cy="420" r="260" fill="${to}" opacity="0.8"/></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(file);
  return file;
}

test.afterAll(async () => {
  await withDb((c) =>
    c.query(
      `DELETE FROM "CatalogItemBackdrop" WHERE "itemId" = (SELECT id FROM "CatalogItem" WHERE slug = $1)`,
      [SLUG],
    ),
  );
});

test('the team adds two more backgrounds; the movie page fades between them', async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard is a desktop tool');
  test.setTimeout(120_000);
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  await signIn(page.context(), mod.token);
  page.on('dialog', (d) => void d.accept());
  await page.goto('/admin/catalogo');
  await page.getByRole('button', { name: new RegExp(`: ${TITLE}`) }).click();

  const extras = page.getByRole('group', { name: /Mais fundos/ });
  await expect(extras).toBeVisible();
  const add = () => extras.locator('.wf-drop--add input[type=file]');
  await add().setInputFiles(await background('fundo-2.jpg', '#2b5876', '#f2c46d'));
  await expect(extras.getByText('Fundo 2 · trocar')).toBeVisible({ timeout: 20_000 });
  await add().setInputFiles(await background('fundo-3.jpg', '#7b2ff7', '#f107a3'));
  await expect(extras.getByText('Fundo 3 · trocar')).toBeVisible({ timeout: 20_000 });
  // the third one goes before the second
  await extras.getByRole('button', { name: /Antes/ }).click();
  await extras.screenshot({ path: `${SHOTS}/admin-mais-fundos.png` });
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações publicadas (no ar).')).toBeVisible();

  const viewer = await (
    await browser.newContext({ viewport: { width: 1280, height: 800 } })
  ).newPage();
  const violations: string[] = [];
  viewer.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await viewer.goto(`/filmes/${SLUG}`);
  const art = viewer.locator('.wf-backdrops');
  await expect(art).toHaveAttribute('data-active', '0');
  await expect(art.locator('.wf-backdrops__layer')).toHaveCount(2); // the next one waits ready
  await viewer.screenshot({ path: `${SHOTS}/filme-1.png` });
  // ~7 s later the next fades in over the first
  await expect(art).toHaveAttribute('data-active', '1', { timeout: 12_000 });
  await viewer.waitForTimeout(800);
  await viewer.screenshot({ path: `${SHOTS}/filme-esmaecendo.png` });
  await expect(art.locator('[data-state="on"]')).toHaveCSS('opacity', '1', { timeout: 3_000 });
  await expect(art.locator('.wf-backdrops__layer')).toHaveCount(3);
  await viewer.screenshot({ path: `${SHOTS}/filme-2.png` });
  await expect(art).toHaveAttribute('data-active', '2', { timeout: 12_000 });
  // and round again to the main one
  await expect(art).toHaveAttribute('data-active', '0', { timeout: 12_000 });
  expect(violations).toEqual([]);
});

test('reduced motion: the movie page stays on its main background', async ({ browser }, info) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({
    reducedMotion: 'reduce',
    ...(info.project.name.startsWith('mobile')
      ? { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true }
      : {}),
  });
  const page = await ctx.newPage();
  // two more backgrounds borrowed from other movies (the dashboard test's are cleaned up)
  await withDb(async (c) => {
    await c.query(
      `DELETE FROM "CatalogItemBackdrop" WHERE "itemId" = (SELECT id FROM "CatalogItem" WHERE slug = $1)`,
      [SLUG],
    );
    await c.query(
      `INSERT INTO "CatalogItemBackdrop"("itemId", position, "assetId")
       SELECT me.id, row_number() OVER (ORDER BY o.slot), o."backdropId"
         FROM "CatalogItem" me, "CatalogItem" o
        WHERE me.slug = $1 AND o.kind = 'MOVIE' AND o.id <> me.id AND o."backdropId" IS NOT NULL
          AND o."backdropId" <> me."backdropId" AND o.slot IS NOT NULL
        ORDER BY o.slot LIMIT 2`,
      [SLUG],
    );
  });
  await page.goto(`/filmes/${SLUG}`);
  const art = page.locator('.wf-backdrops');
  await expect(art).toHaveAttribute('data-active', '0');
  await page.waitForTimeout(9_000);
  await expect(art).toHaveAttribute('data-active', '0');
  await page.screenshot({ path: `${SHOTS}/filme-sem-movimento-${info.project.name}.png` });
  await ctx.close();
});
