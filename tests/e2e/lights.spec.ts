/**
 * Cinema lights (2026-11-11): the ambient glow on a title page, the ticket stubs on /perfil, the
 * split-flap board on Cronograma and the marquee lights around the live player.
 * Screenshots go to test-results/lights.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { signIn, withDb } from './support/seed';

const SHOTS = 'test-results/lights';
mkdirSync(SHOTS, { recursive: true });

/** CSP refusals and hydration errors the page logs while `fn` runs. */
async function consoleProblems(page: Page, fn: () => Promise<void>) {
  const seen: string[] = [];
  const onMsg = (m: { text: () => string }) => {
    const t = m.text();
    if (/Content Security Policy|Refused to apply|Hydration|did not match/i.test(t)) seen.push(t);
  };
  page.on('console', onMsg);
  await fn();
  page.off('console', onMsg);
  return seen;
}

test('ambient glow: the poster colour lights the title page', async ({ page }, info) => {
  const slug = await withDb(async (c) => {
    const r = await c.query<{ slug: string }>(
      `SELECT slug FROM "CatalogItem" WHERE kind = 'MOVIE' AND status = 'ACTIVE' AND "posterId" IS NOT NULL
        ORDER BY slot LIMIT 1`,
    );
    return r.rows[0]!.slug;
  });
  const problems = await consoleProblems(page, async () => {
    await page.goto(`/filmes/${slug}`);
    const halo = page.locator('svg.wf-ambient--halo');
    await expect(halo).toHaveCount(1);
    await expect(page.locator('svg.wf-ambient--wash')).toHaveCount(1);
    const accent = (await halo.getAttribute('data-accent'))!;
    expect(accent).toMatch(/^#[0-9a-f]{6}$/);
    // the colour is in the gradient, as an attribute
    await expect(halo.locator('stop').first()).toHaveAttribute('stop-color', accent);
    // behind the poster, and bigger than it
    const poster = (await page.locator('.wf-detail__poster').boundingBox())!;
    const glow = (await halo.boundingBox())!;
    expect(glow.width).toBeGreaterThan(poster.width * 2);
    expect(glow.x).toBeLessThan(poster.x);
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `${SHOTS}/ambient-${info.project.name}.png`,
      clip: {
        x: 0,
        y: 0,
        width: page.viewportSize()!.width,
        height: Math.min(1100, poster.y + poster.height + 160),
      },
    });
  });
  expect(problems).toEqual([]);
  // stored once worked out
  const stored = await withDb(async (c) => {
    const r = await c.query<{ accent: string | null }>(
      `SELECT m.accent FROM "CatalogItem" ci JOIN "MediaAsset" m ON m.id = ci."posterId" WHERE ci.slug = $1`,
      [slug],
    );
    return r.rows[0]!.accent;
  });
  expect(stored).toMatch(/^#[0-9a-f]{6}$/);
});

test('ticket stubs: my orders on /perfil are cinema tickets', async ({ browser }, info) => {
  // the seed's sponsor, signed in through a fresh session row (her orders stay as they are)
  const token = randomBytes(32).toString('base64url');
  await withDb((c) =>
    c.query(
      `INSERT INTO "Session"(id, "tokenHash", "userId", "authTime", "createdAt", "lastSeenAt", "idleExpiresAt", "expiresAt", "uaFamily")
       SELECT $1, $2, id, now(), now(), now(), now() + interval '8 hours', now() + interval '1 day', 'Chrome · Linux'
         FROM "User" WHERE username = 'luana_v'`,
      [randomUUID(), createHash('sha256').update(token).digest()],
    ),
  );
  const ctx = await browser.newContext();
  await signIn(ctx, token);
  const page = await ctx.newPage();
  try {
    const problems = await consoleProblems(page, async () => {
      await page.goto('/perfil');
      const list = page.locator('.wf-stubs');
      await expect(list).toBeVisible();
      const valid = list.locator('a.wf-stub--valid, a.wf-stub--used').first();
      await expect(valid).toBeVisible();
      await expect(valid).toHaveAttribute('href', /^\/pedido\/[A-Z0-9-]+$/);
      await expect(valid).toHaveAttribute('aria-label', /: (patrocínio|contribuição) de R\$/);
      await expect(valid.locator('.wf-stub__tear')).toContainText('R$');
      // the notches are cut by a mask
      expect(
        await valid.locator('.wf-stub__main').evaluate((e) => getComputedStyle(e).maskImage),
      ).toContain('radial-gradient');
      await valid.scrollIntoViewIfNeeded();
      if (
        info.project.name.startsWith('desktop') &&
        (await valid.getAttribute('class'))!.includes('valid')
      ) {
        await valid.hover();
        await expect
          .poll(() => valid.locator('.wf-stub__tear').evaluate((e) => getComputedStyle(e).rotate))
          .not.toBe('none');
      }
      await page.waitForTimeout(300);
      await list.screenshot({ path: `${SHOTS}/stubs-${info.project.name}.png` });
    });
    expect(problems).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('split-flap: Cronograma lists the next titles on a departures board that flips into place', async ({
  page,
}, info) => {
  const problems = await consoleProblems(page, async () => {
    await page.goto('/cronograma');
    const region = page.getByRole('region', { name: 'Painel de sessões' });
    await expect(region).toBeVisible();
    const rows = region.locator('.wf-flap__row');
    expect(await rows.count()).toBeGreaterThan(0);
    // every row has a sentence for screen readers and fixed-width tiles
    await expect(rows.first().locator('.sr-only')).toHaveText(/\d{2}:\d{2}: .+ — /);
    await expect(rows.first().locator('.wf-flap__cell--title .wf-flap__tile')).toHaveCount(18);
    await region.scrollIntoViewIfNeeded();
    // it flips, then settles on the real text
    const board = region.locator('.wf-flap');
    await expect(board).toHaveAttribute('data-flap', 'done', { timeout: 8_000 });
    const label = (await rows.first().locator('.sr-only').textContent())!;
    const title = label.split(': ').slice(1).join(': ').split(' — ')[0]!;
    const tiles = (
      await rows.first().locator('.wf-flap__cell--title .wf-flap__glyph').allTextContents()
    )
      .join('')
      .replace(/\xa0/g, ' ')
      .trim();
    expect(title.toLocaleUpperCase('pt-BR').startsWith(tiles.replace(/\.$/, ''))).toBe(true);
    // the board never makes the page scroll sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await board.screenshot({ path: `${SHOTS}/flapboard-${info.project.name}.png` });
    // the countdown digits are flaps too
    await expect(page.locator('.wf-countdown__d').first()).toBeVisible();
    await page
      .getByRole('region', { name: 'Em breve' })
      .locator('.wf-countdown')
      .screenshot({ path: `${SHOTS}/countdown-${info.project.name}.png` });
  });
  expect(problems).toEqual([]);
});

test('marquee: bulbs chase around the live player while a live is on', async ({ page }, info) => {
  await withDb((c) =>
    c.query(
      `UPDATE "StreamSession" SET status = 'PLANNED', "startedAt" = NULL, "nowItemId" = NULL WHERE status = 'LIVE'`,
    ),
  );
  const sessionId = await withDb(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO "StreamSession" (id, "startsAt", "capacityMinutes", status, "startedAt", "updatedAt")
       VALUES (gen_random_uuid(), now(), 120, 'LIVE', now(), now()) RETURNING id`,
    );
    return r.rows[0]!.id;
  });
  try {
    const problems = await consoleProblems(page, async () => {
      await page.goto('/');
      const live = page.getByRole('region', { name: 'Ao vivo agora' });
      await expect(live).toBeVisible();
      const marquee = live.locator('.wf-marquee');
      const bulbs = marquee.locator('circle.wf-bulb');
      const n = await bulbs.count();
      expect(n).toBeGreaterThan(60);
      expect(n % 3).toBe(0);
      expect(await bulbs.first().evaluate((e) => getComputedStyle(e).animationName)).toBe(
        'wf-chase',
      );
      // the player sits inside the bulbs, still 16:9
      const box = (await marquee.boundingBox())!;
      const frame = (await marquee.locator('.wf-twitch__frame').boundingBox())!;
      expect(frame.x).toBeGreaterThan(box.x);
      expect(frame.y).toBeGreaterThan(box.y);
      expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1);
      await live.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await marquee.screenshot({ path: `${SHOTS}/marquee-${info.project.name}.png` });
    });
    expect(problems).toEqual([]);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    expect(
      await page
        .locator('circle.wf-bulb')
        .first()
        .evaluate((e) => getComputedStyle(e).animationName),
    ).toBe('none');
  } finally {
    await withDb((c) => c.query(`DELETE FROM "StreamSession" WHERE id = $1`, [sessionId]));
  }
});
