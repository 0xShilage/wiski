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

test('a title page: the poster palette, and no colour line under the title', async ({
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
  // no line under the title (removed 2026-11-13)
  const bar = await page
    .locator('#titulo')
    .evaluate((el) => getComputedStyle(el, '::after').content);
  expect(['none', 'normal']).toContain(bar);
  await page.screenshot({ path: `${SHOTS}/palette-${info.project.name}.png` });
});

test('the marathon trail follows the parts done on the Agenda', async ({ page }, info) => {
  const fx = await withDb(async (c) => {
    const r = await c.query<{ id: string; slug: string; campaignId: string }>(
      `SELECT ci.id, ci.slug, c.id AS "campaignId" FROM "CatalogItem" ci
         JOIN "Campaign" c ON c."itemId" = ci.id
        WHERE ci.kind = 'SERIES' AND ci.status IN ('ACTIVE', 'FUNDED') ORDER BY ci.slot LIMIT 1`,
    );
    const it = r.rows[0]!;
    await c.query(`UPDATE "CatalogItem" SET "episodeCount" = 8 WHERE id = $1`, [it.id]);
    const sessions = [randomUUID(), randomUUID(), randomUUID()];
    for (const [k, h] of [-72, -24, 48].entries())
      await c.query(
        `INSERT INTO "StreamSession"(id, "startsAt", "capacityMinutes", "updatedAt")
         VALUES ($1, now() + make_interval(hours => $2), 300, now())`,
        [sessions[k], h],
      );
    const parts: [number, number, number, string][] = [
      [0, 1, 3, 'DONE'],
      [1, 4, 6, 'DONE'],
      [2, 7, 8, 'SCHEDULED'],
    ];
    for (const [k, from, to, status] of parts)
      await c.query(
        `INSERT INTO "LiveSegment"(id, "sessionId", kind, "campaignId", label, "seasonNumber",
           "episodeFrom", "episodeTo", minutes, status, "doneAt")
         VALUES ($1, $2, 'PART', $3, $4, 1, $5::int, $6::int, 135, $7::"LiveSegmentStatus",
           CASE WHEN $7::text = 'DONE' THEN now() + make_interval(secs => $5::int) END)`,
        [randomUUID(), sessions[k], it.campaignId, `T1 · E${from}–E${to}`, from, to, status],
      );
    return { ...it, sessions };
  });
  try {
    await page.goto(`/series/${fx.slug}`);
    const trail = page.getByRole('region', { name: 'Trilha da maratona' });
    await expect(trail).toContainText('6 de 8 episódios em 2 lives.');
    await expect(trail.locator('.wf-trail__stop')).toHaveCount(4);
    await expect(trail.locator('.wf-trail__stop.is-done')).toHaveCount(2);
    await expect(trail.locator('[aria-current="step"]')).toContainText('T1 · E7–E8');
    await expect(trail.locator('.wf-trail__here')).toContainText('Você está aqui');
    await expect(trail.locator('.wf-trail__stop').last()).toContainText('Fim da série');
    await trail.scrollIntoViewIfNeeded();
    await trail.screenshot({ path: `${SHOTS}/trail-${info.project.name}.png` });
  } finally {
    await withDb((c) =>
      c.query(`DELETE FROM "StreamSession" WHERE id = ANY($1::uuid[])`, [fx.sessions]),
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
