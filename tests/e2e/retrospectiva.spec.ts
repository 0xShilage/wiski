/**
 * "Seu ano na Wiskiflix" (2026-11-12): the recap's story cards in the browser — tap / keys /
 * buttons, moving on by itself (and not with reduced motion), the shareable 1080×1920 image.
 * Screenshots go to test-results/retrospectiva.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

const SHOTS = 'test-results/retrospectiva';
mkdirSync(SHOTS, { recursive: true });

test('a guest is asked to sign in', async ({ page }) => {
  await page.goto('/retrospectiva');
  await expect(page.getByRole('heading', { name: 'Seu ano na Wiskiflix', level: 1 })).toBeVisible();
  await expect(page.getByText(/Entre para ver/)).toBeVisible();
});

test('a viewer goes through their year and shares it', async ({ page, context }, info) => {
  test.setTimeout(90_000);
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to|Hydration/i.test(m.text())) violations.push(m.text());
  });
  const u = await seedUser();
  await signIn(context, u.token);
  const ids = await withDb(async (c) => {
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
    const order = randomUUID();
    await c.query(
      `INSERT INTO "Order" (id, "publicCode", kind, "itemId", "userId", "contactEmail", "buyerKey",
         "accessTokenHash", "runtimeMinutes", "ruleSetId", "rescheduleCount", breakdown,
         "subtotalCents", "queueJumpCents", "totalCents", status, "paidAt", "clientRequestId",
         "createdAt", "updatedAt")
       VALUES ($1, $2, 'MOVIE', $3, $4, $5, $6, $7, $8, $9, 0, '[]', 2000, 0, 2000, 'PAID', now(),
         $10, now(), now())`,
      [
        order,
        `WF-${randomBytes(3).toString('hex').toUpperCase()}`,
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
    const reviewed = await c.query<{ id: string }>(
      `SELECT id FROM "CatalogItem" WHERE slug = 'a-primeira-live'`,
    );
    await c.query(
      `INSERT INTO "Review"(id, "userId", "itemId", rating, body, "updatedAt") VALUES ($1, $2, $3, 5, 'Que live!', now())`,
      [randomUUID(), u.id, reviewed.rows[0]!.id],
    );
    await c.query(
      `INSERT INTO "Suggestion"(id, "userId", kind, title, "titleKey") VALUES ($1, $2, 'MOVIE', 'Amélie', 'amelie')`,
      [randomUUID(), u.id],
    );
    return { order, title: it.title };
  });

  try {
    await page.goto('/retrospectiva');
    const recap = page.getByRole('region', { name: /^Seu ano na Wiskiflix \d{4}$/ });
    const card = recap.locator('.wf-recap__card');
    await expect(card).toHaveAttribute('aria-label', '1 de 7');
    await expect(card).toContainText('Seu ano na Wiskiflix');
    await expect(card).toContainText(`@${u.username}`);
    await expect(recap.locator('.wf-recap__bar')).toHaveCount(7);

    // it moves on by itself (7 s a card)
    await expect(card).toHaveAttribute('aria-label', '2 de 7', { timeout: 10_000 });
    await expect(card).toContainText(/A live em \d{4}/);

    // pause: the bar stops
    await recap.getByRole('button', { name: 'Pausar' }).click();
    await expect(recap).toHaveClass(/is-paused/);
    await recap.getByRole('button', { name: 'Continuar' }).click();

    // tap the right side → next; the left third → back
    const stage = recap.locator('.wf-recap__stage');
    const box = (await stage.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
    await expect(card).toHaveAttribute('aria-label', '3 de 7');
    await expect(card).toContainText('Você patrocinou');
    await expect(card.locator('.wf-recap__num')).toHaveText('1');
    await expect(card.getByRole('img', { name: ids.title })).toBeVisible();
    // paused for the picture (a screenshot that settles animations would finish the bar)
    await recap.getByRole('button', { name: 'Pausar' }).click();
    await page.screenshot({
      path: `${SHOTS}/patrocinio-${info.project.name}.png`,
      animations: 'disabled',
    });
    await recap.getByRole('button', { name: 'Continuar' }).click();
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height / 2);
    await expect(card).toHaveAttribute('aria-label', '2 de 7');

    // keys
    await recap.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(card).toHaveAttribute('aria-label', '4 de 7');
    await expect(card).toContainText('Sua crítica');
    await recap.getByRole('button', { name: 'Próximo' }).click();
    await expect(card).toContainText('Suas sugestões');
    await recap.getByRole('button', { name: 'Próximo' }).click();
    await expect(card).toContainText('Seu papel na live');
    await expect(card.locator('.wf-recap__persona')).toHaveText('Quem banca a sessão');
    await recap.getByRole('button', { name: 'Próximo' }).click();
    await expect(card).toHaveAttribute('aria-label', '7 de 7');
    await expect(recap.getByRole('button', { name: 'Próximo' })).toBeDisabled();
    // not watched yet → no minutes
    await expect(card.locator('.wf-recap__stats li')).toHaveText([
      /^1\s*filme patrocinado$/,
      /^1\s*avaliação$/,
      /^1\s*sugestão$/,
    ]);
    await page.screenshot({
      path: `${SHOTS}/final-${info.project.name}.png`,
      animations: 'disabled',
    });

    // the image: desktop Chromium can't share files → a PNG download
    if (!info.project.name.startsWith('mobile')) {
      const download = page.waitForEvent('download');
      await card.getByRole('button', { name: 'Compartilhar imagem' }).click();
      const d = await download;
      expect(d.suggestedFilename()).toMatch(/^retrospectiva-wiski-\d{4}\.png$/);
      const file = `${SHOTS}/retrospectiva-imagem.png`;
      await d.saveAs(file);
      const { default: sharp } = await import('sharp');
      const meta = await sharp(file).metadata();
      expect([meta.width, meta.height]).toEqual([1080, 1920]);
      await expect(card.getByRole('status')).toContainText('Imagem salva');
    }
    await card.getByRole('button', { name: 'Ver de novo' }).click();
    await expect(card).toHaveAttribute('aria-label', '1 de 7');

    // reduced motion: nothing moves on its own, no pause button
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(card).toContainText('Use os botões abaixo para avançar.');
    await expect(recap.getByRole('button', { name: 'Pausar' })).toHaveCount(0);
    await page.waitForTimeout(8_000);
    await expect(card).toHaveAttribute('aria-label', '1 de 7');
    await page.screenshot({
      path: `${SHOTS}/intro-${info.project.name}.png`,
      animations: 'disabled',
    });
    expect(violations).toEqual([]);
  } finally {
    await withDb(async (c) => {
      await c.query(`DELETE FROM "Order" WHERE id = $1`, [ids.order]);
      await c.query(`DELETE FROM "Review" WHERE "userId" = $1`, [u.id]);
      await c.query(`DELETE FROM "Suggestion" WHERE "userId" = $1`, [u.id]);
    });
  }
});
