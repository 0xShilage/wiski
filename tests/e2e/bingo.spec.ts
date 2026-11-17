/**
 * Bingo da live (2026-11-16): a viewer takes today's card on /bingo; a moderator marks three of
 * its items in Admin › Bingo; the viewer's card stamps them, the line glows and their name is in
 * today's winners. On a phone the card fits the screen. Screenshots go to test-results/bingo.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

const SHOTS = 'test-results/bingo';
mkdirSync(SHOTS, { recursive: true });
test.describe.configure({ mode: 'serial' });

function cspWatch(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

/** today's calls, cards and wins go, so each run starts from an empty day */
async function clearToday() {
  await withDb(async (c) => {
    await c.query(`DELETE FROM "BingoWin"`);
    await c.query(`DELETE FROM "BingoCall"`);
    await c.query(`DELETE FROM "BingoCard"`);
    await c.query(`UPDATE "BingoRound" SET winners = 0`);
  });
}
test.beforeAll(clearToday);
test.afterAll(clearToday);

test('a viewer takes a card, the team marks a line, the viewer has a bingo', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'one run is enough; the phone layout below');
  test.setTimeout(120_000);

  const page = await browser.newPage();
  const violations = cspWatch(page);
  const viewer = await seedUser();
  await signIn(page.context(), viewer.token);
  await page.goto('/bingo');
  await page.getByRole('button', { name: 'Pegar minha cartela' }).click();
  const card = page.locator('.wf-bingo__card');
  await expect(card.locator('li')).toHaveCount(9);
  await expect(page.getByText('Sua cartela de hoje está pronta. Boa sorte!')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/cartela.png` });

  // the first row of the viewer's card
  const row = await withDb(async (c) => {
    const r = await c.query<{ cells: number[] }>(
      `SELECT cells FROM "BingoCard" WHERE "userId" = $1`,
      [viewer.id],
    );
    return r.rows[0]!.cells.slice(0, 3);
  });

  const modPage = await browser.newPage();
  const modViolations = cspWatch(modPage);
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  await signIn(modPage.context(), mod.token);
  await modPage.goto('/admin/bingo');
  const board = modPage.locator('.wf-bingo-admin__board');
  for (const [i, p] of row.entries()) {
    const button = board.locator('.wf-bingo-admin__call', {
      has: modPage.locator('.wf-bingo-admin__num', { hasText: new RegExp(`^${p}$`) }),
    });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    if (i < 2) await expect(modPage.getByText('Item marcado.')).toBeVisible();
  }
  await expect(modPage.getByText('Item marcado. 1 pessoa fez bingo!')).toBeVisible();
  await expect(modPage.locator('.wf-bingo__winners')).toContainText('1º');
  await modPage.screenshot({ path: `${SHOTS}/admin.png`, fullPage: true });

  // a pressed item that made a bingo can't be taken back
  const first = board.locator('.wf-bingo-admin__call[aria-pressed="true"]').first();
  await first.click();
  await expect(modPage.locator('.wf-toast--err')).toContainText('não pode ser desmarcado');
  await modPage.close();

  // the viewer's page asks again by itself (every 15 s while visible)
  await expect(page.getByText(/BINGO! Você é o 1º lugar de hoje/)).toBeVisible({ timeout: 25_000 });
  await expect(card).toHaveClass(/is-won/);
  await expect(card.locator('.wf-bingo__cell.is-line')).toHaveCount(3);
  await expect(card.locator('.wf-bingo__cell.is-called')).toHaveCount(3);
  const winners = page.locator('.wf-bingo__winners');
  await expect(winners).toContainText(`@${viewer.username}`);
  // a fresh load for the picture (a page that sat behind another one keeps a stale frame)
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(card.locator('.wf-bingo__cell.is-line')).toHaveCount(3);
  await page.screenshot({ path: `${SHOTS}/bingo.png`, fullPage: true });

  // the ranking has a Bingo board
  await page.goto('/ranking');
  await expect(
    page.getByRole('region', { name: 'Bingo' }).getByText(`@${viewer.username}`),
  ).toBeVisible();
  expect(violations).toEqual([]);
  expect(modViolations).toEqual([]);
});

test('on a phone the card fits the screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-360', 'the card on a phone');
  const violations = cspWatch(page);
  const viewer = await seedUser();
  await signIn(page.context(), viewer.token);
  await page.goto('/bingo');
  await page.getByRole('button', { name: 'Pegar minha cartela' }).click();
  await expect(page.locator('.wf-bingo__card li')).toHaveCount(9);
  await page.screenshot({ path: `${SHOTS}/celular.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  expect(violations).toEqual([]);
});
