/**
 * Desktop resolutions the site is optimised for (R1 request): 1920×1080, 1366×768, 1536×864,
 * 1280×720 and 3440×1440 — each both full-screen and with typical browser chrome + taskbar
 * (≈ 120–140 px less height). On the Filmes hero the title, call to action, price line and
 * the ◀ ▶ arrows must sit in the first screen, nothing may overlap, and there is never a
 * horizontal scrollbar. Screenshots: test-results/viewports/.
 */
import { expect, type Page, test } from '@playwright/test';
import { seedUser, signIn } from './support/seed';

const SIZES: [number, number, string][] = [
  [1920, 1080, 'full'],
  [1920, 947, 'browser'],
  [1366, 768, 'full'],
  [1366, 625, 'browser'],
  [1536, 864, 'full'],
  [1536, 730, 'browser'],
  [1280, 720, 'full'],
  [1280, 593, 'browser'],
  [3440, 1440, 'full'],
  [3440, 1305, 'browser'],
];

test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'desktop resolutions run once');
});

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, selector).not.toBeNull();
  return b!;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const [w, h, kind] of SIZES) {
  test(`Filmes hero fits ${w}×${h} (${kind})`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await noHorizontalScroll(page);

    const header = await box(page, '.wf-header__inner');
    const title = await box(page, '.wf-hero__title');
    const ctas = await box(page, '.wf-hero__ctas');
    const price = await box(page, '.wf-hero__price');
    const arrows = await box(page, '.wf-hero__controls');
    const rail = await box(page, '.wf-rail--ring');
    const active = await box(page, '.wf-rail--ring .wf-card[aria-current="true"]');

    // Everything needed to act is in the first screen.
    for (const [name, b] of [
      ['title', title],
      ['CTAs', ctas],
      ['price', price],
      ['arrows', arrows],
    ] as const) {
      expect(b.y + b.height, `${name} bottom`).toBeLessThanOrEqual(h);
      expect(b.x + b.width, `${name} right`).toBeLessThanOrEqual(w);
    }
    // No overlaps: header above the title, content and arrows above the poster rail.
    expect(header.y + header.height).toBeLessThanOrEqual(title.y);
    expect(price.y + price.height).toBeLessThanOrEqual(rail.y + 1);
    expect(arrows.y + arrows.height).toBeLessThanOrEqual(rail.y + 1);
    // The active poster is fully visible on screen at these sizes.
    expect(active.y + active.height, 'active poster bottom').toBeLessThanOrEqual(h);
    // Ultrawide: the text column stays near the centre stage, not glued to the far edge.
    if (w >= 3000) expect(title.x).toBeGreaterThan(400);

    await page.screenshot({ path: `test-results/viewports/filmes-${w}x${h}.png` });
  });
}

for (const [w, h] of [
  [1366, 768],
  [1280, 720],
  [3440, 1440],
] as const) {
  test(`Séries, a detail page and the dashboard at ${w}×${h}`, async ({ page, context }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/series', { waitUntil: 'networkidle' });
    await noHorizontalScroll(page);
    const feature = await box(page, '.wf-feature');
    expect(feature.y).toBeLessThan(h);
    await page.screenshot({ path: `test-results/viewports/series-${w}x${h}.png` });

    await page.goto('/filmes/a-noite-do-esquilo', { waitUntil: 'networkidle' });
    await noHorizontalScroll(page);
    const panel = await box(page, '#patrocinar');
    expect(panel.y + 120).toBeLessThan(h);
    await page.screenshot({ path: `test-results/viewports/detalhe-${w}x${h}.png` });

    const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
    await signIn(context, mod.token);
    await page.goto('/admin/catalogo', { waitUntil: 'networkidle' });
    await noHorizontalScroll(page);
    const slots = await box(page, '.wf-slots');
    expect(slots.y).toBeLessThan(h / 2);
    // The page itself does not scroll: each column scrolls on its own.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(h);
    await page.screenshot({ path: `test-results/viewports/painel-${w}x${h}.png` });
  });
}

// Phase 6: the header tabs from 761 px (below that the phone tab bar takes over). 2026-11-09:
// seven tabs + "Mais ▾" (Jogos, Assistidos, Avaliações, Sugestões, Roleta, Links)
for (const w of [761, 800, 900, 1024, 1080, 1100, 1180, 1280]) {
  test(`header: logo, seven tabs and "Mais" on one line at ${w} px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto('/links', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await noHorizontalScroll(page);
    const tabs = page.locator('.wf-header .wf-nav > a, .wf-header .wf-nav > .wf-nav__more');
    await expect(tabs).toHaveCount(8);
    const logo = await box(page, '.wf-logo');
    const boxes = await tabs.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, width: r.width, scroll: e.scrollWidth };
      }),
    );
    expect(boxes[0]!.left).toBeGreaterThan(logo.x + logo.width);
    expect(boxes.at(-1)!.right).toBeLessThanOrEqual(w);
    for (const b of boxes) {
      expect(Math.abs(b.top - boxes[0]!.top)).toBeLessThan(1); // one row
      expect(b.scroll).toBeLessThanOrEqual(Math.ceil(b.width)); // no clipped label
    }
    for (let i = 1; i < boxes.length; i++)
      expect(boxes[i]!.left).toBeGreaterThan(boxes[i - 1]!.right);
  });
}
