/**
 * Keepsakes (2026-11-13): the most-liked review as a newspaper clipping, the poster's palette and
 * main colour on a title page, the marathon trail, and Roleta prizes as raffle tickets.
 * Screenshots go to test-results/keepsakes.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

const SHOTS = 'test-results/keepsakes';
mkdirSync(SHOTS, { recursive: true });
const PATH = {
  MOVIE: 'filmes',
  SERIES: 'series',
  FRANCHISE: 'franquias',
  ANIME: 'animes',
} as const;

test('the most-liked review is a clipping of the Gazeta Wiski', async ({ page }, info) => {
  const [author, fan] = await Promise.all([seedUser(), seedUser()]);
  const item = await withDb(async (c) => {
    const r = await c.query<{ id: string; slug: string; kind: keyof typeof PATH }>(
      `SELECT id, slug, kind FROM "CatalogItem" WHERE status = 'WATCHED' AND "posterId" IS NOT NULL
        ORDER BY "watchedAt" DESC LIMIT 1`,
    );
    const it = r.rows[0]!;
    const review = randomUUID();
    await c.query(
      `INSERT INTO "Review"(id, "userId", "itemId", rating, body, "updatedAt")
       VALUES ($1, $2, $3, 5, $4, now())`,
      [
        review,
        author.id,
        it.id,
        'Que sessão! A trilha sonora, a fotografia, o chat inteiro gritando na mesma cena — ' +
          'daquelas noites que a gente lembra por muito tempo. Assistiria de novo amanhã.',
      ],
    );
    // likes from a lot of people make it the most liked
    for (let i = 0; i < 9; i++) {
      const u = i === 0 ? fan : await seedUser();
      await c.query(`INSERT INTO "ReviewLike"("userId", "reviewId") VALUES ($1, $2)`, [
        u.id,
        review,
      ]);
    }
    return it;
  });
  try {
    await page.goto(`/${PATH[item.kind]}/${item.slug}`);
    const clip = page.getByRole('figure', { name: 'A crítica mais curtida' });
    await expect(clip).toContainText('Gazeta Wiski');
    await expect(clip).toContainText(`— @${author.username}`);
    await expect(clip).toContainText('5 de 5 estrelas');
    await expect(clip.locator('.wf-clipping__body')).toContainText('Que sessão!');
    await clip.scrollIntoViewIfNeeded();
    await clip.screenshot({ path: `${SHOTS}/clipping-${info.project.name}.png` });
  } finally {
    await withDb((c) => c.query(`DELETE FROM "Review" WHERE "userId" = $1`, [author.id]));
  }
});

test('a title page: the poster palette and the poster colour on the decorations', async ({
  page,
}, info) => {
  const slug = await withDb(async (c) => {
    const r = await c.query<{ slug: string }>(
      `SELECT slug FROM "CatalogItem" WHERE kind = 'MOVIE' AND status = 'ACTIVE'
         AND "posterId" IS NOT NULL ORDER BY slot LIMIT 1`,
    );
    return r.rows[0]!.slug;
  });
  await page.goto(`/filmes/${slug}`);
  const strip = page.getByRole('img', { name: /^Paleta do pôster: #[0-9a-f]{6}/ });
  await expect(strip).toBeVisible();
  const n = await strip.locator('rect').count();
  expect(n).toBeGreaterThanOrEqual(2);
  expect(n).toBeLessThanOrEqual(5);
  await expect(page.locator('.wf-detail')).toHaveAttribute('data-accented', 'true');
  const bar = await page
    .locator('#titulo')
    .evaluate((el) => getComputedStyle(el, '::after').backgroundColor);
  expect(bar).not.toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: `${SHOTS}/palette-${info.project.name}.png` });
});

test('the marathon trail: seasons watched, the next stop, "você está aqui"', async ({
  page,
}, info) => {
  const item = await withDb(async (c) => {
    const r = await c.query<{ id: string; slug: string; seasonCount: number }>(
      `SELECT id, slug, "seasonCount" FROM "CatalogItem"
        WHERE kind = 'SERIES' AND status IN ('ACTIVE', 'FUNDED') AND "seasonCount" >= 3
        ORDER BY slot LIMIT 1`,
    );
    const it = r.rows[0]!;
    await c.query(
      `UPDATE "CatalogItem" SET "partsWatched" = 2, "partsWatchedAt" = now() WHERE id = $1`,
      [it.id],
    );
    return it;
  });
  try {
    await page.goto(`/series/${item.slug}`);
    const trail = page.getByRole('region', { name: 'Trilha da maratona' });
    await expect(trail).toContainText(`2 de ${item.seasonCount} temporadas assistidas.`);
    await expect(trail.locator('.wf-trail__stop')).toHaveCount(item.seasonCount);
    await expect(trail.locator('.wf-trail__stop.is-done')).toHaveCount(2);
    await expect(trail.locator('[aria-current="step"]')).toContainText('Temporada 3');
    await expect(trail.locator('.wf-trail__here')).toContainText('Você está aqui');
    await trail.scrollIntoViewIfNeeded();
    await trail.screenshot({ path: `${SHOTS}/trail-${info.project.name}.png` });
  } finally {
    await withDb((c) =>
      c.query(
        `UPDATE "CatalogItem" SET "partsWatched" = 0, "partsWatchedAt" = NULL WHERE id = $1`,
        [item.id],
      ),
    );
  }
});

test('a Roleta prize is a raffle ticket, stamped "Premiado"', async ({ page, context }, info) => {
  const viewer = await seedUser();
  const id = randomUUID();
  await withDb((c) =>
    c.query(
      `INSERT INTO "RoletaSpin"(id, "userId", period, n, prize, slot, status, "createdAt")
       VALUES ($1, $2, ((now() AT TIME ZONE 'America/Sao_Paulo') - interval '17 hours')::date,
               1, 'FILME', 0, 'PENDING', now())`,
      [id, viewer.id],
    ),
  );
  await signIn(context, viewer.token);
  await page.goto('/roleta');
  const ticket = page
    .getByRole('region', { name: 'Seus prêmios' })
    .getByRole('listitem')
    .filter({ hasText: 'Filme grátis' });
  const serial = id.replace(/-/g, '').slice(-6).toUpperCase();
  await expect(ticket).toContainText(`Bilhete premiado nº ${serial}.`);
  await expect(ticket.locator('.wf-raffle__stamp')).toHaveText('Premiado');
  await expect(ticket.locator('.wf-raffle__no')).toHaveText(`Nº ${serial}`);
  // the form still works inside the ticket
  await expect(ticket.getByLabel('Seu usuário da Twitch')).toBeVisible();
  await page.waitForTimeout(600);
  await ticket.scrollIntoViewIfNeeded();
  await ticket.screenshot({ path: `${SHOTS}/raffle-${info.project.name}.png` });
});
