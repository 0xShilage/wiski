/**
 * Premium details (2026-11-14): every title page has its own share image; the tab's icon gets a
 * red dot while a live is on; focus, selection and scrollbar in the site's own colours.
 * Screenshots go to test-results/premium-details.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { withDb } from './support/seed';

const SHOTS = 'test-results/premium-details';
mkdirSync(SHOTS, { recursive: true });

test('each title page shares its own designed image', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'images are the same for every screen');
  await page.goto('/');
  const href = (await page.locator('.wf-movie-grid .wf-scard').first().getAttribute('href'))!;
  await page.goto(href);
  const og = await page.locator('meta[property="og:image"]').first().getAttribute('content');
  expect(og).toMatch(/\/opengraph-image/);
  const res = await request.get(og!.replace(/^https?:\/\/[^/]+/, ''));
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
  const png = await res.body();
  const meta = await sharp(png).metadata();
  expect([meta.width, meta.height]).toEqual([1200, 630]);
  writeFileSync(`${SHOTS}/compartilhar-filme.png`, png);
  // it isn't the site's generic card: the title's own art is in it (busy, not a flat background)
  const stats = await sharp(png).stats();
  expect(Math.max(...stats.channels.map((c) => c.stdev))).toBeGreaterThan(20);

  // an unknown title still gets an image (the site's card), never an error
  const ogPath = new URL(og!).pathname;
  const none = await request.get(ogPath.replace(href, '/filmes/nao-existe-esse-filme'));
  expect(none.status()).toBe(200);
  expect(none.headers()['content-type']).toContain('image/png');
});

test('the tab icon shows a red dot while Iara is live', async ({ page }) => {
  const id = randomUUID();
  await withDb((c) =>
    c.query(
      `INSERT INTO "StreamSession"(id, "startsAt", "capacityMinutes", status, "startedAt", "updatedAt")
       VALUES ($1, now() - interval '10 minutes', 240, 'LIVE', now() - interval '5 minutes', now())`,
      [id],
    ),
  );
  try {
    await page.goto('/cronograma');
    await expect(page.locator('.wf-livebar')).toBeVisible();
    const icons = page.locator('link[rel~="icon"]');
    await expect(icons.first()).toHaveAttribute('href', '/fx/icon-live.png');
    const own = await icons.first().getAttribute('data-wf-href');
    expect(own).toBeTruthy();
    expect(own).not.toBe('/fx/icon-live.png');
  } finally {
    await withDb((c) => c.query(`DELETE FROM "StreamSession" WHERE id = $1`, [id]));
  }
});

test('focus, selection and scrollbar wear the site colours', async ({ page }, info) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus-visible').first();
  await expect(focused).toBeVisible();
  const ring = await focused.evaluate((e) => {
    const s = getComputedStyle(e);
    return { style: s.outlineStyle, width: s.outlineWidth, offset: s.outlineOffset };
  });
  expect(ring).toEqual({ style: 'solid', width: '2px', offset: '3px' });
  const sel = await page.evaluate(() => {
    const probe = document.createElement('p');
    probe.textContent = 'x';
    document.body.append(probe);
    const bg = getComputedStyle(probe, '::selection').backgroundColor;
    probe.remove();
    return bg;
  });
  expect(sel).toBe('rgba(169, 157, 224, 0.38)');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth)).toBe(
    'thin',
  );
  await page.screenshot({ path: `${SHOTS}/foco-${info.project.name}.png` });
});
