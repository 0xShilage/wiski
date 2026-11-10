/**
 * Filmes hero carousel + trailer modal (12 §2 step 8 "done when"): buttons, keyboard, counter,
 * announcements, sold/reserved states, swipe on touch screens; the YouTube player is created
 * only after the click, Esc closes it, and the page has 0 CSP violations with the trailer open.
 */
import { expect, type Page, test } from '@playwright/test';
import { withDb } from './support/seed';

const STUB = '<!doctype html><title>player</title><p>stub player</p>';

async function trackCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: unknown[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__csp.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        disposition: e.disposition,
      }),
    );
  });
}
const enforced = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __csp: { disposition: string }[] }).__csp.filter(
      (v) => v.disposition === 'enforce',
    ),
  );

const count = (page: Page) => page.locator('.wf-hero__count');
const title = (page: Page) => page.locator('.wf-hero__title');

test.beforeEach(async ({ page }) => {
  // Hermetic: never reach Google; record whether anything tried to.
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: STUB }),
  );
});

test('arrows, counter and announcement; no auto-rotation', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const total = (await count(page).textContent())!.split('/')[1]!.trim();
  await expect(count(page)).toHaveText(`01 / ${total}`);
  const first = await title(page).textContent();
  await page.waitForTimeout(1500);
  await expect(count(page)).toHaveText(`01 / ${total}`); // nothing moves by itself
  await page.getByRole('button', { name: 'Próximo filme' }).click();
  await expect(count(page)).toHaveText(`02 / ${total}`);
  await expect(title(page)).not.toHaveText(first!);
  await expect(page.locator('[aria-live="polite"]').first()).toContainText(
    `filme 2 de ${Number(total)}`,
  );
  await page.getByRole('button', { name: 'Filme anterior' }).click();
  await page.getByRole('button', { name: 'Filme anterior' }).click(); // wraps to the last one
  await expect(count(page)).toHaveText(`${total} / ${total}`);
});

test('keyboard: ← → move while focus is in the carousel; focus follows the active poster', async ({
  page,
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'keyboard on desktop');
  await page.goto('/', { waitUntil: 'networkidle' });
  const active = page.locator('.wf-rail--ring button.wf-card[aria-current="true"]');
  await active.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(count(page)).toContainText('03 /');
  await expect(active).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(count(page)).toContainText('02 /');
  // Only the active poster is in the tab order.
  expect(await page.locator('.wf-rail--ring button.wf-card[tabindex="0"]').count()).toBe(1);
  // A click on another poster selects it.
  await page.locator('.wf-rail--ring button.wf-card').nth(12).click();
  await expect(active).toBeFocused();
});

test('a sponsored movie is on /fila, not in the carousel; a reserved one shows why', async ({
  page,
}) => {
  // 2026-11-09 ("Fila"): the seed's sponsored movie (@luana_v) left the board for /fila
  await page.goto('/fila');
  await expect(page.locator('.wf-fila')).toContainText('Patrocínio: @luana_v');
  await page.goto('/', { waitUntil: 'networkidle' });
  // the seed's reserved movie (pending Pix); its place on the board depends on what earlier specs
  // sponsored, so step until it is on screen
  const next = page.getByRole('button', { name: 'Próximo filme' });
  for (let i = 0; i < 12; i++) {
    if ((await page.locator('.wf-hero__ctas').textContent())?.includes('Reservado')) break;
    await next.click();
  }
  await expect(page.locator('.wf-hero__ctas')).toContainText('Reservado');
  await expect(page.locator('.wf-hero__price')).toContainText('35 minutos');
});

test('touch swipe changes the movie (phones)', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('mobile'), 'touch only');
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('.wf-hero__stage').evaluate((el) => {
    const fire = (type: string, x: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 7,
          pointerType: 'touch',
          clientX: x,
          clientY: 300,
        }),
      );
    fire('pointerdown', 300);
    fire('pointerup', 120);
  });
  await expect(count(page)).toContainText('02 /');
});

test('trailer: nothing loads before the click; modal with the player; Esc closes; 0 CSP violations', async ({
  page,
}) => {
  await trackCsp(page);
  const youtube: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('youtube')) youtube.push(r.url());
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  expect(youtube).toEqual([]);
  expect(await page.locator('iframe').count()).toBe(0);

  const button = page.locator('.wf-hero__ctas').getByRole('button', { name: 'Assistir trailer' });
  await button.click();
  const dialog = page.getByRole('dialog', { name: /Trailer:/ });
  await expect(dialog).toBeVisible();
  const frame = dialog.locator('iframe');
  await expect(frame).toHaveAttribute(
    'src',
    /^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}\?autoplay=1&rel=0$/,
  );
  await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  await expect(frame).toHaveAttribute(
    'allow',
    'autoplay; encrypted-media; fullscreen; picture-in-picture',
  );
  await expect(page.frameLocator('dialog iframe').getByText('stub player')).toBeVisible();
  expect(youtube.length).toBeGreaterThan(0);
  expect(await enforced(page)).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('iframe')).toHaveCount(0); // the player is destroyed, not hidden
  await expect(button).toBeFocused();
  expect(await enforced(page)).toEqual([]);
});

test('detail pages keep the trailer modal CSP-clean too', async ({ page }) => {
  await trackCsp(page);
  await page.goto('/series/cronicas-do-bosque', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Assistir trailer' }).first().click();
  await expect(page.locator('dialog iframe')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar' }).click();
  expect(await enforced(page)).toEqual([]);
});

test('"Adicionar texto?" off: the card shows only the poster, its name stays accessible', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'one run is enough (data is shared)');
  const slug = 'a-noite-do-esquilo';
  await withDb((c) =>
    c.query(`UPDATE "CatalogItem" SET "posterTitle" = false WHERE slug = $1`, [slug]),
  );
  try {
    await page.goto('/', { waitUntil: 'networkidle' });
    const card = page.locator('.wf-rail--ring .wf-card[aria-current="true"]');
    await expect(card).toHaveAccessibleName(/A Noite do Esquilo/);
    await expect(card.locator('.wf-card__title')).toHaveCount(0);
    // the other cards still carry their title
    await expect(page.locator('.wf-rail--ring .wf-card__title').first()).toBeVisible();
  } finally {
    await withDb((c) =>
      c.query(`UPDATE "CatalogItem" SET "posterTitle" = true WHERE slug = $1`, [slug]),
    );
  }
});
