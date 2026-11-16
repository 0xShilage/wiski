/**
 * "Emblema ao lado do nome" (2026-11-15): a viewer who claimed an event badge picks it on /perfil
 * (the preview shows the name with it), and it then shows next to their @username on their review
 * (/avaliacoes), their public profile and the member card; switching to "Nenhum" takes it off.
 * A moderator can show the team role. Screenshots go to test-results/name-badge.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { seedUser, signIn, withDb } from './support/seed';

const SHOTS = 'test-results/name-badge';
mkdirSync(SHOTS, { recursive: true });
test.describe.configure({ mode: 'serial' });

function cspWatch(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

const BADGE = 'Maratona Estrelada';

test.afterAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `UPDATE "User" SET "nameBadgeEmblemId" = NULL, "nameBadgeRole" = false, "nameBadgeAchievement" = NULL`,
    );
    await c.query(
      `DELETE FROM "BadgeClaim" WHERE "badgeId" IN (SELECT id FROM "Badge" WHERE name = $1)`,
      [BADGE],
    );
    await c.query(`DELETE FROM "Badge" WHERE name = $1`, [BADGE]);
  });
});

test('a viewer shows a claimed badge next to their name, on reviews and the profile', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'one run is enough; mobile layout below');
  test.setTimeout(120_000);

  // the badge (open now, no word). Its art: one already uploaded by an earlier spec when there is
  // one (CI's per-IP upload limit is shared by the whole run), else uploaded here by the team.
  const existing = await withDb((c) =>
    c.query<{ id: string }>(`SELECT id FROM "MediaAsset" WHERE role = 'BADGE' LIMIT 1`),
  );
  if (existing.rows[0]) {
    await withDb((c) =>
      c.query(
        `INSERT INTO "Badge"(id, slug, name, description, "assetId", "startsAt", "endsAt", "updatedAt")
         VALUES ($1, $2, $3, 'Para quem viu a maratona inteira.', $4, now() - interval '1 hour', now() + interval '1 day', now())`,
        [
          randomUUID(),
          `maratona-estrelada-${Date.now().toString(36)}`,
          BADGE,
          existing.rows[0]!.id,
        ],
      ),
    );
  } else {
    const modPage = await browser.newPage();
    const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
    await signIn(modPage.context(), mod.token);
    await modPage.goto('/admin/emblemas');
    await modPage.getByRole('button', { name: 'Novo emblema' }).click();
    const form = modPage.getByRole('form', { name: 'Novo emblema' });
    const png = await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect x="16" y="16" width="224" height="224" rx="56" fill="#f2a7dd"/><path d="M128 52l22 46 50 6-37 34 10 50-45-25-45 25 10-50-37-34 50-6z" fill="#4f3d72"/></svg>',
          ),
        },
      ])
      .png()
      .toBuffer();
    await form
      .locator('input[type=file]')
      .setInputFiles({ name: 'estrela.png', mimeType: 'image/png', buffer: png });
    await expect(form.locator('.wf-badge-drop img')).toHaveAttribute('src', /^\/media\//, {
      timeout: 20_000,
    });
    await form.getByLabel('Nome').fill(BADGE);
    await form.getByLabel(/História do emblema/).fill('Para quem viu a maratona inteira.');
    await form.getByRole('button', { name: 'Criar emblema' }).click();
    await expect(modPage.getByText('Emblema criado')).toBeVisible();
    await modPage.close();
  }

  // a viewer claims it and has a review
  const page = await browser.newPage();
  const violations = cspWatch(page);
  const viewer = await seedUser();
  await signIn(page.context(), viewer.token);
  await page.goto('/emblemas');
  const card = page.locator('.wf-badge-card', { hasText: BADGE });
  await card.getByRole('button', { name: 'Resgatar emblema' }).click();
  await expect(card).toContainText('Resgatado! Está na sua coleção.');
  const username = await withDb(async (c) => {
    const item = await c.query<{ id: string }>(
      `SELECT i.id FROM "CatalogItem" i WHERE i.status IN ('WATCHED','ARCHIVED')
         AND EXISTS (SELECT 1 FROM "WatchEvent" w WHERE w."itemId" = i.id) LIMIT 1`,
    );
    await c.query(
      `INSERT INTO "Review"(id, "userId", "itemId", rating, body, "updatedAt") VALUES ($1, $2, $3, 5, $4, now())`,
      [randomUUID(), viewer.id, item.rows[0]!.id, 'Maratona inesquecível, chorei no final.'],
    );
    const u = await c.query<{ username: string }>(`SELECT username FROM "User" WHERE id = $1`, [
      viewer.id,
    ]);
    return u.rows[0]!.username;
  });

  // /perfil: pick it; the preview and the member card show it
  await page.goto('/perfil');
  const section = page.getByRole('region', { name: 'Emblema ao lado do nome' });
  await expect(section.getByRole('radio', { name: 'Nenhum' })).toBeChecked();
  await section.getByRole('radio', { name: new RegExp(BADGE) }).check();
  await expect(section.getByRole('status')).toHaveText('Emblema salvo.');
  await expect(section.locator('.wf-nb-pick__preview img')).toHaveAttribute(
    'alt',
    `Emblema ${BADGE}`,
  );
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/perfil-escolher.png` });
  await page.reload();
  await expect(section.getByRole('radio', { name: new RegExp(BADGE) })).toBeChecked();
  await expect(page.locator('.wf-member__name img')).toHaveAttribute('alt', `Emblema ${BADGE}`);

  // next to the name on the review and the public profile
  await page.goto('/avaliacoes');
  const review = page.getByRole('article', { name: `Avaliação de @${username}` });
  await expect(review.locator('.wf-review__author img[alt^="Emblema"]')).toHaveAttribute(
    'alt',
    `Emblema ${BADGE}`,
  );
  await review.scrollIntoViewIfNeeded();
  await review.screenshot({ path: `${SHOTS}/avaliacao.png` });
  await page.goto(`/u/${username}`);
  await expect(page.getByRole('heading', { level: 1 }).locator('img')).toHaveAttribute(
    'alt',
    `Emblema ${BADGE}`,
  );
  await page.screenshot({ path: `${SHOTS}/perfil-publico.png` });

  // "Nenhum" takes it off everywhere
  await page.goto('/perfil');
  await section.getByRole('radio', { name: 'Nenhum' }).check();
  await expect(section.getByRole('status')).toHaveText('Sem emblema ao lado do nome.');
  await page.goto(`/u/${username}`);
  await expect(page.getByRole('heading', { level: 1 }).locator('img')).toHaveCount(0);
  expect(violations).toEqual([]);
});

test('a moderator can show the team role next to their name', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-360', 'the picker on a phone');
  const violations = cspWatch(page);
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  await signIn(page.context(), mod.token);
  await page.goto('/perfil');
  const section = page.getByRole('region', { name: 'Emblema ao lado do nome' });
  await section.getByRole('radio', { name: /Moderação/ }).check();
  await expect(section.getByRole('status')).toHaveText('Emblema salvo.');
  await expect(section.locator('.wf-nb-pick__preview [aria-label="Moderação"]')).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/equipe-celular.png` });
  // the page doesn't scroll sideways on a phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  expect(violations).toEqual([]);
});
