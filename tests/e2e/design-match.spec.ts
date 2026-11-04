/**
 * Design check (12 §3 "pages match the design PNGs at 390 / 1440 / 1920"): each screen of
 * docs/design/ is rendered at the same size and state, then written next to the design as one
 * side-by-side image (test-results/design/<name>.png: design left, build right) for review.
 * The art differs on purpose (seed placeholders), so the automatic checks are the Figma
 * metrics that must hold exactly: side margins, active poster centred, header order, 16:9 player.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import sharp from 'sharp';
import { seedUser, signIn } from './support/seed';

const OUT = 'test-results/design';
const DESIGN = 'docs/design';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'design sizes are set per test');
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>p</title><body bgcolor="black">',
    }),
  );
});

async function sideBySide(page: Page, name: string, fullPage = false) {
  mkdirSync(OUT, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500); // fade-in of the backdrop
  const build = await page.screenshot({ fullPage });
  const design = sharp(join(DESIGN, `${name}.png`));
  const d = await design.metadata();
  const b = await sharp(build).metadata();
  const h = Math.max(d.height!, b.height!);
  const gap = 24;
  await sharp({
    create: { width: d.width! + gap + b.width!, height: h, channels: 3, background: '#000' },
  })
    .composite([
      { input: await design.toBuffer(), left: 0, top: 0 },
      { input: build, left: d.width! + gap, top: 0 },
    ])
    .png()
    .toFile(join(OUT, `${name}.png`));
}

async function heroMetrics(page: Page) {
  return page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const active = r('.wf-rail--ring .wf-card[aria-current="true"]');
    return {
      W: document.documentElement.clientWidth,
      titleX: r('.wf-hero__title').left,
      logoX: r('.wf-header__inner a').left,
      activeCentre: active.left + active.width / 2,
      nav: [...document.querySelectorAll('.wf-header nav a')].map((a) => a.textContent?.trim()),
    };
  });
}

for (const [w, h, margin] of [
  [1920, 1080, 160],
  [1440, 1080, 120],
] as const) {
  test(`Filmes ${w}: Figma margins, centred active poster, header order`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/', { waitUntil: 'networkidle' });
    const m = await heroMetrics(page);
    expect(Math.round(m.titleX)).toBe(margin);
    expect(Math.round(m.logoX)).toBe(margin);
    expect(Math.abs(m.activeCentre - m.W / 2)).toBeLessThan(2);
    // Cronograma (2026-10-31), Sugestões and Links (Phase 6), Assistidos (2026-11-01) and
    // Roleta (2026-11-04) are additions to the Figma header
    expect(m.nav).toEqual([
      'Filmes',
      'Séries',
      'Franquias',
      'Cronograma',
      'Assistidos',
      'Avaliações',
      'Sugestões',
      'Roleta',
      'Links',
      'Perfil',
    ]);
    await sideBySide(page, `r1-filmes-${w}`);
  });
}

test('Filmes 1440, sponsored state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/', { waitUntil: 'networkidle' });
  const next = page.getByRole('button', { name: 'Próximo filme' });
  for (let i = 0; i < 3; i++) await next.click();
  await expect(page.locator('.wf-hero__ctas')).toContainText('Patrocinado');
  await sideBySide(page, 'r1-filmes-1440-sponsored');
});

test('Filmes 390 (phone): bottom tab bar, CTA first, rail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByRole('navigation', { name: 'Principal (celular)' })).toBeVisible();
  // The sponsor action is shown first (above the trailer button) on phones.
  const sponsor = (await page.locator('.wf-hero__ctas .wf-btn--primary-slot').boundingBox())!;
  const trailer = (await page
    .locator('.wf-hero__ctas')
    .getByRole('button', { name: 'Assistir trailer' })
    .boundingBox())!;
  expect(sponsor.y + sponsor.height).toBeLessThanOrEqual(trailer.y);
  expect(Math.round(sponsor.width)).toBe(Math.round(trailer.width));
  await sideBySide(page, 'r1-filmes-mobile');
  await page.locator('.wf-rail--strip').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  await sideBySide(page, 'r1-filmes-mobile-rail');
});

test('Trailer modal 1440×900: 16:9 player', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('.wf-hero__ctas').getByRole('button', { name: 'Assistir trailer' }).click();
  const frame = page.locator('dialog iframe');
  await expect(frame).toBeVisible();
  const b = (await frame.boundingBox())!;
  expect(Math.abs(b.width / b.height - 16 / 9)).toBeLessThan(0.02);
  // centred on screen (Tailwind's preflight would otherwise pin a <dialog> to the top-left)
  const d = (await page.locator('dialog.wf-modal').boundingBox())!;
  expect(Math.abs(d.y - (900 - d.y - d.height))).toBeLessThan(4);
  expect(Math.abs(d.x - (1440 - d.x - d.width))).toBeLessThan(4);
  await sideBySide(page, 'r1-trailer-modal');
});

test('Séries 1440 (full page)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/series', { waitUntil: 'networkidle' });
  await expect(page.locator('.wf-feature progress')).toBeVisible();
  await sideBySide(page, 'r1-series-1440', true);
});

test('Dashboard 1440', async ({ page, context }) => {
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  await signIn(context, mod.token);
  await page.setViewportSize({ width: 1440, height: 1047 });
  await page.goto('/admin/catalogo', { waitUntil: 'networkidle' });
  await expect(page.getByText('● Verificação em duas etapas ok')).toBeVisible();
  await sideBySide(page, 'r1-admin-1440');
});
