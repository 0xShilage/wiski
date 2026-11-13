/**
 * Theater (2026-11-11): the Ken Burns backdrop on title pages and the campaign seat map.
 * Screenshots go to test-results/theater.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

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

test('seat map as a theater: the title on the screen, a contributor on their seat', async ({
  page,
  context,
}, info) => {
  const url = await campaignTitle();
  const slug = url.split('/').pop()!;
  const u = await seedUser();
  const order = randomUUID();
  await withDb(async (c) => {
    const r = await c.query<{ campaignId: string; itemId: string }>(
      `SELECT c.id AS "campaignId", ci.id AS "itemId" FROM "Campaign" c
         JOIN "CatalogItem" ci ON ci.id = c."itemId" WHERE ci.slug = $1`,
      [slug],
    );
    const { campaignId, itemId } = r.rows[0]!;
    await c.query(
      `INSERT INTO "Order" (id, "publicCode", kind, "itemId", "campaignId", "userId", "contactEmail",
         "buyerKey", "accessTokenHash", breakdown, "subtotalCents",
         "queueJumpCents", "totalCents", status, "paidAt", "clientRequestId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'CONTRIBUTION', $3, $4, $5, $6, $7, $8, '[]', 1000, 0, 1000, 'PAID', now(),
         $9, now(), now())`,
      [
        order,
        `WF-${randomBytes(3).toString('hex').toUpperCase()}`,
        itemId,
        campaignId,
        u.id,
        `${u.id}@example.com`,
        `u:${u.id}`,
        randomBytes(32),
        randomUUID(),
      ],
    );
  });
  try {
    await signIn(context, u.token);
    await page.goto(url);
    const room = page.getByRole('img', { name: /um deles é o seu/ });
    await expect(room).toBeVisible();
    await expect(room.locator('.wf-seatmap__art')).toHaveAttribute('href', /^\/media\//);
    const mine = room.locator('g.wf-seat--mine');
    await expect(mine).toHaveCount(1);
    await expect(mine.locator('image')).toHaveAttribute('href', /^\/avatars\//);
    await expect(page.locator('.wf-seatmap__key--mine')).toHaveText('seu lugar');
    await page.waitForTimeout(900);
    await page
      .locator('#contribuir')
      .screenshot({ path: `${SHOTS}/seatmap-mine-${info.project.name}.png` });
  } finally {
    await withDb((c) => c.query(`DELETE FROM "Order" WHERE id = $1`, [order]));
  }
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
