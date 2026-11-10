/**
 * Design batch (2026-11-10): the "AO VIVO" bar, the neon logo on a first visit, the squirrel 404,
 * the cinema ticket on a paid order with its popcorn burst (the like burst: reviews.spec.ts).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

const SHOTS = 'test-results/design-batch';
mkdirSync(SHOTS, { recursive: true });

async function endLive() {
  await withDb((c) =>
    c.query(
      `UPDATE "StreamSession" SET status = 'PLANNED', "startedAt" = NULL, "nowItemId" = NULL WHERE status = 'LIVE'`,
    ),
  );
}

test('AO VIVO: a slim bar on top of every page while a live is on, with what is on screen', async ({
  page,
}, info) => {
  await endLive();
  await page.goto('/links');
  await expect(page.locator('.wf-livebar')).toHaveCount(0);
  const before = await page.locator('.wf-logo').evaluate((e) => e.getBoundingClientRect().top);

  const title = await withDb(async (c) => {
    const item = await c.query<{ id: string; title: string }>(
      `SELECT id, title FROM "CatalogItem" WHERE kind = 'MOVIE' AND status = 'ACTIVE' ORDER BY slot LIMIT 1`,
    );
    const it = item.rows[0]!;
    await c.query(
      `INSERT INTO "StreamSession" (id, "startsAt", "capacityMinutes", status, "startedAt", "nowItemId", "updatedAt")
       VALUES (gen_random_uuid(), now(), 120, 'LIVE', now(), $1, now())`,
      [it.id],
    );
    return it.title;
  });
  try {
    for (const path of ['/links', '/cronograma']) {
      await page.goto(path);
      const bar = page.getByRole('link', { name: /Ao vivo/ });
      await expect(bar).toBeVisible();
      await expect(bar).toContainText(`Agora: ${title}`);
      await expect(bar).toHaveAttribute('href', 'https://www.twitch.tv/iarawiski');
      await expect(bar).toHaveAttribute('target', '_blank');
      // the header moved down by the bar; nothing overlaps it
      const barBox = (await bar.boundingBox())!;
      expect(Math.round(barBox.y)).toBe(0);
      const after = await page.locator('.wf-logo').evaluate((e) => e.getBoundingClientRect().top);
      expect(after).toBeGreaterThanOrEqual(barBox.height);
      expect(after - before).toBeGreaterThan(30);
      // the pulsing dot on the logo
      expect(
        await page
          .locator('.wf-logo')
          .evaluate((e) => getComputedStyle(e, '::after').getPropertyValue('content')),
      ).not.toBe('none');
    }
    await page.screenshot({ path: `${SHOTS}/ao-vivo-${info.project.name}.png` });
    // the bar asks again when the tab comes back: the live ended → it goes away
    await endLive();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('.wf-livebar')).toHaveCount(0);
  } finally {
    await endLive();
  }
});

test.describe('first visit', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the logo flickers on like a neon sign once, then stays lit on later visits', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    const logo = page.locator('.wf-header .wf-logo');
    await expect(logo).toHaveClass(/wf-logo--ignite/);
    expect(await logo.locator('svg').evaluate((e) => getComputedStyle(e).animationName)).toBe(
      'wf-neon-on',
    );
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === '__Host-wf_neon')?.value)
      .toBe('1');
    await page.reload();
    await expect(logo).not.toHaveClass(/wf-logo--ignite/);
    expect(await logo.locator('svg').evaluate((e) => getComputedStyle(e).animationName)).toBe(
      'none',
    );
  });
});

test('404: the squirrel says the title left the queue, with a way back', async ({ page }, info) => {
  const res = await page.goto('/um-endereco-que-nao-existe');
  expect(res?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Esse título saiu da fila…' }),
  ).toBeVisible();
  await expect(page.locator('.wf-oops__squirrel svg')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver os filmes' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Ver a Fila' })).toHaveAttribute('href', '/fila');
  await page.screenshot({ path: `${SHOTS}/404-${info.project.name}.png` });
});

test('paid order: a cinema ticket with the Fila seat, popcorn on arrival, shareable as an image', async ({
  page,
  context,
}, info) => {
  const u = await seedUser();
  await signIn(context, u.token);
  const code = `WF-${randomBytes(3).toString('hex').toUpperCase()}`; // hex ⊂ Crockford
  const { orderId, title } = await withDb(async (c) => {
    const item = await c.query<{ id: string; title: string; runtimeMinutes: number }>(
      `SELECT i.id, i.title, i."runtimeMinutes" FROM "CatalogItem" i
       WHERE i.kind = 'MOVIE' AND i.status = 'ACTIVE' AND i."posterId" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."itemId" = i.id
                         AND o.status IN ('PENDING_PAYMENT','PAID','SCHEDULED','WATCHING','COMPLETED'))
       ORDER BY i.slot DESC LIMIT 1`,
    );
    const it = item.rows[0]!;
    const rs = await c.query<{ id: string }>(
      `SELECT id FROM "PriceRuleSet" WHERE status = 'ACTIVE' LIMIT 1`,
    );
    const id = randomUUID();
    await c.query(
      `INSERT INTO "Order" (id, "publicCode", kind, "itemId", "userId", "contactEmail", "buyerKey",
         "accessTokenHash", "runtimeMinutes", "ruleSetId", "rescheduleCount", breakdown,
         "subtotalCents", "queueJumpCents", "totalCents", status, "paidAt", "clientRequestId",
         "createdAt", "updatedAt")
       VALUES ($1, $2, 'MOVIE', $3, $4, $5, $6, $7, $8, $9, 0, '[]', 2000, 0, 2000, 'PAID', now(),
         $10, now(), now())`,
      [
        id,
        code,
        it.id,
        u.id,
        `${u.id}@example.com`,
        `u:${u.id}`,
        randomBytes(32),
        it.runtimeMinutes ?? 100,
        rs.rows[0]!.id,
        randomUUID(),
      ],
    );
    return { orderId: id, title: it.title };
  });
  try {
    await page.goto(`/pedido/${code}`);
    const ticket = page.getByRole('region', { name: `Ingresso: ${title}` });
    await expect(ticket).toBeVisible();
    await expect(ticket).toContainText('Ingresso · Patrocínio');
    await expect(ticket).toContainText(`@${u.username}`);
    await expect(ticket.locator('.wf-ticket__seat')).toHaveText(/^(\d{2}|—)$/);
    await expect(ticket.locator('.wf-ticket__code')).toHaveText(code);
    // paid just now → the popcorn burst plays over the ticket
    await expect(page.locator('.wf-ticket-stage .wf-pop .wf-pop__p')).toHaveCount(16);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/ingresso-${info.project.name}.png`, fullPage: true });

    // "Compartilhar ingresso": desktop Chromium can't share files → a PNG download
    if (!info.project.name.startsWith('mobile')) {
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Compartilhar ingresso' }).click();
      const d = await download;
      expect(d.suggestedFilename()).toMatch(/^ingresso-wiski-.+\.png$/);
      const file = `${SHOTS}/ingresso-imagem.png`;
      await d.saveAs(file);
      const { default: sharp } = await import('sharp');
      const meta = await sharp(file).metadata();
      expect([meta.width, meta.height]).toEqual([1080, 1920]);
      await expect(page.getByRole('status').filter({ hasText: 'Imagem salva' })).toBeVisible();
    }
  } finally {
    await withDb((c) => c.query(`DELETE FROM "Order" WHERE id = $1`, [orderId]));
  }
});
