/**
 * Premium feel (2026-11-14): a movie's page is fetched when the pointer rests on its card, so the
 * click lands at once and the poster morphs into the title page (a view transition); images still
 * on their way show a soft placeholder and fade in. Screenshots go to test-results/premium.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'test-results/premium';
mkdirSync(SHOTS, { recursive: true });

function cspWatch(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

test('resting on a movie fetches its page; the click morphs the poster into it', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'hover is a mouse thing');
  const violations = cspWatch(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __vt: number };
    w.__vt = 0;
    const start = document.startViewTransition?.bind(document);
    if (start) {
      document.startViewTransition = ((arg: Parameters<typeof start>[0]) => {
        w.__vt += 1;
        return start(arg);
      }) as typeof document.startViewTransition;
    }
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const card = page.locator('.wf-movie-grid .wf-scard').first();
  const href = (await card.getAttribute('href'))!;
  const fetched = page.waitForRequest(
    (r) => new URL(r.url()).pathname === href && r.headers()['rsc'] === '1',
    { timeout: 5_000 },
  );
  await card.hover();
  await fetched; // before any click
  await page.waitForTimeout(300);
  const t0 = Date.now();
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.locator('.wf-detail__poster img')).toBeVisible();
  const took = Date.now() - t0;
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBeGreaterThan(
    0,
  );
  // a prefetched page lands without a round trip
  expect(took).toBeLessThan(1_500);
  await expect(page.locator('.wf-route-loader')).toHaveCount(0);
  expect(violations).toEqual([]);
});

test('a slow image shows its soft placeholder, then fades in', async ({ page }, info) => {
  const violations = cspWatch(page);
  await page.goto('/');
  const href = (await page.locator('.wf-movie-grid .wf-scard').first().getAttribute('href'))!;
  // hold the images back a moment
  await page.route('**/media/**', async (route) => {
    await new Promise((r) => setTimeout(r, 4_000));
    await route.continue();
  });
  await page.goto(href);
  const pending = page.locator('picture[data-lq] img.is-pending');
  await expect(pending.first()).toBeAttached({ timeout: 5_000 });
  const lq = await page.evaluate(() => {
    const img = document.querySelector('picture[data-lq] img.is-pending');
    return (img?.parentElement as HTMLElement | null)?.style.getPropertyValue('--lq') ?? '';
  });
  expect(lq).toMatch(/^url\("data:image\/webp;base64,/);
  await page.screenshot({ path: `${SHOTS}/carregando-imagens-${info.project.name}.png` });
  await expect(pending).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/imagens-chegaram-${info.project.name}.png` });
  expect(violations).toEqual([]);
});
