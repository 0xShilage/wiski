/**
 * Theater (2026-11-11): the Ken Burns backdrop on title pages and the campaign seat map.
 * Screenshots go to test-results/theater.
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { withDb } from './support/seed';

const SHOTS = 'test-results/theater';
mkdirSync(SHOTS, { recursive: true });
const PATH = { SERIES: 'series', FRANCHISE: 'franquias', ANIME: 'animes' } as const;

/** A live title with a campaign that has money in it (the seed has several). */
async function campaignTitle() {
  const row = await withDb(async (c) => {
    const r = await c.query<{ slug: string; kind: keyof typeof PATH }>(
      `SELECT ci.slug, ci.kind FROM "Campaign" c JOIN "CatalogItem" ci ON ci.id = c."itemId"
        WHERE ci.status = 'ACTIVE' AND c."raisedCents" > 0 AND c."raisedCents" < c."goalCents"
        ORDER BY c."raisedCents" DESC LIMIT 1`,
    );
    return r.rows[0];
  });
  expect(row, 'the dev seed has a partly funded campaign').toBeTruthy();
  return `/${PATH[row!.kind]}/${row!.slug}`;
}

test('seat map: the campaign as a cinema, seats in proportion to the goal', async ({
  page,
}, info) => {
  await page.goto(await campaignTitle());
  const room = page.getByRole('img', { name: /^Sala de cinema da campanha: \d+% da meta/ });
  await expect(room).toBeVisible();
  const label = (await room.getAttribute('aria-label'))!;
  const [, pct, taken, total] = /: (\d+)% da meta, (\d+) de (\d+) lugares/.exec(label)!;
  expect(Number(total)).toBe(60);
  expect(Number(taken)).toBeGreaterThan(0);
  expect(Number(taken)).toBeLessThan(60);
  // what is drawn is what is said
  await expect(room.locator('use.wf-seat--taken')).toHaveCount(Number(taken));
  await expect(page.locator('.wf-seatmap__caption')).toContainText(`Sala ${pct}% cheia`);
  // a visitor who didn't contribute has no seat of their own
  await expect(room.locator('.wf-seat--mine')).toHaveCount(0);
  await page.waitForTimeout(900); // the seats' entrance
  await page
    .locator('#contribuir')
    .screenshot({ path: `${SHOTS}/seatmap-${info.project.name}.png` });
});

test('ken burns: the backdrop slowly pans (one of four), and stays still with reduce motion', async ({
  page,
}) => {
  const url = await campaignTitle();
  await page.goto(url);
  const art = page.locator('.wf-detail__art');
  const kb = await art.getAttribute('data-kb');
  expect(['1', '2', '3', '4']).toContain(kb);
  const img = art.locator('img');
  await expect(img).toHaveCount(1);
  expect(await img.evaluate((el) => getComputedStyle(el).animationName)).toBe(`wf-kb-${kb}`);
  // the zoomed picture is clipped to the backdrop box (an unclipped one showed a raw strip under
  // the shade), and right below the box the page is the plain ink colour again
  expect(await art.evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
  await page.waitForTimeout(1500);
  const box = (await art.boundingBox())!;
  await page.screenshot({
    path: `${SHOTS}/kenburns-${test.info().project.name}.png`,
    clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: box.y + box.height + 80 },
  });
  // the same title always gets the same pan
  await page.reload();
  expect(await art.getAttribute('data-kb')).toBe(kb);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  expect(await art.locator('img').evaluate((el) => getComputedStyle(el).animationName)).toBe(
    'none',
  );
});
