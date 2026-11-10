/**
 * Reviews in the browser (Phase 3): the XSS corpus rendered under the real CSP stays inert text;
 * spoilers fold; a signed-in viewer likes and reports; a moderator works the queue.
 * Writing a review needs Turnstile, which can't load without internet here — the API tests cover
 * creation (tests/integration/reviews.test.ts).
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { XSS_CORPUS } from '../support/xss-corpus';
import { seedUser, signIn, withDb } from './support/seed';

test.describe.configure({ mode: 'serial' });

const PAGE = '/filmes/a-primeira-live';

async function itemId(slug: string): Promise<string> {
  return withDb(
    async (c) => (await c.query('SELECT id FROM "CatalogItem" WHERE slug = $1', [slug])).rows[0].id,
  );
}

/** A review by a fresh (40-day-old) user, written straight into the DB. */
async function seedReview(
  slug: string,
  body: string,
  opts: { spoiler?: boolean; rating?: number } = {},
) {
  const author = await seedUser();
  const id = randomUUID();
  const item = await itemId(slug);
  await withDb(async (c) => {
    await c.query(`UPDATE "User" SET "createdAt" = now() - interval '40 days' WHERE id = $1`, [
      author.id,
    ]);
    await c.query(
      `INSERT INTO "Review"(id, "userId", "itemId", rating, body, "containsSpoilers", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [id, author.id, item, opts.rating ?? 4, body, opts.spoiler ?? false],
    );
  });
  return { id, author };
}

function failOnDialog(page: Page) {
  page.on('dialog', async (d) => {
    await d.dismiss();
    throw new Error(`a dialog opened: ${d.message()}`);
  });
}

async function cspViolations(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as { __csp: unknown[] }).__csp);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: unknown[]; __xss: number };
    w.__csp = [];
    w.__xss = 0;
    // enforced violations only (the report-only Trusted Types trial is P1-d)
    document.addEventListener('securitypolicyviolation', (e) => {
      if (e.disposition === 'enforce') w.__csp.push(e.violatedDirective);
    });
  });
});

test('the XSS corpus renders as literal text: no dialog, no injected element, no CSP report', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'one run is enough (data is shared)');
  failOnDialog(page);
  const slug = 'esquilo-de-natal';
  const ids: string[] = [];
  for (const payload of XSS_CORPUS) {
    // stored exactly as the API would store it (the sanitiser runs server-side; here we store the
    // raw payload on purpose — worse than anything the API lets through)
    // Postgres text can't hold NUL; drop the payloads with C0 controls (covered by the API tests)
    if ([...payload].some((ch) => ch.codePointAt(0)! < 0x20)) continue;
    const body = payload;
    ids.push((await seedReview(slug, body)).id);
  }
  await page.goto(`/filmes/${slug}`);
  // load every page of reviews
  const more = page.getByRole('button', { name: 'Carregar mais' });
  while (await more.count()) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/reviews?') && r.ok()),
      more.click(),
    ]);
    await page.waitForTimeout(300);
  }
  const list = page.locator('.wf-reviews__list');
  await expect(list.getByText('<script>alert(1)</script>', { exact: true })).toBeVisible();
  await expect(list.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible();
  // nothing from the payloads became markup inside the review list
  for (const sel of [
    'script',
    'img[src="x"]',
    'svg[onload]',
    'iframe',
    'object',
    'base',
    'meta',
    'form',
    'input',
    'style',
    'details[ontoggle]',
    'x',
  ]) {
    await expect(list.locator(`.wf-review__body ${sel}`), sel).toHaveCount(0);
  }
  expect(
    await page.locator('[onerror], [onload], [onclick], [onfocus], [ontoggle], [onbegin]').count(),
  ).toBe(0);
  await page.mouse.move(10, 10);
  await page.keyboard.press('Tab');
  expect(await cspViolations(page)).toEqual([]);
  await withDb((c) => c.query('DELETE FROM "Review" WHERE id = ANY($1::uuid[])', [ids]));
});

test('spoilers stay folded until asked', async ({ page }) => {
  const { id } = await seedReview('a-primeira-live', `Final revelado ${randomUUID().slice(0, 6)}`, {
    spoiler: true,
  });
  await page.goto(PAGE);
  const card = page
    .locator('.wf-review', { has: page.locator('.wf-chip', { hasText: 'Contém spoiler' }) })
    .first();
  await expect(card.locator('.wf-review__body')).toBeHidden();
  await card.getByText('Mostrar texto').click();
  await expect(card.locator('.wf-review__body')).toBeVisible();
  await withDb((c) => c.query('DELETE FROM "Review" WHERE id = $1', [id]));
});

test('anonymous visitors see the summary and a sign-in invitation, no like/report buttons', async ({
  page,
}) => {
  await page.goto(PAGE);
  await expect(page.getByRole('heading', { name: 'Avaliações' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Entrar para avaliar' })).toHaveAttribute(
    'href',
    /\/perfil\?returnTo=/,
  );
  await expect(page.getByRole('button', { name: 'Denunciar' })).toHaveCount(0);
  await expect(page.getByLabel('Distribuição das notas')).toBeVisible();
});

test('a signed-in viewer likes and reports a review', async ({ page, context }) => {
  const marker = randomUUID().slice(0, 8);
  const { id } = await seedReview('a-primeira-live', `Avaliação para curtir ${marker}`);
  const viewer = await seedUser();
  await withDb((c) =>
    c.query(`UPDATE "User" SET "createdAt" = now() - interval '10 days' WHERE id = $1`, [
      viewer.id,
    ]),
  );
  await signIn(context, viewer.token);
  await page.goto(PAGE);

  const card = page.locator('.wf-review', { hasText: marker });
  const like = card.getByRole('button', { name: /Curtir|Remover curtida/ });
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect(like).toContainText('1');
  // a small popcorn burst from the button (2026-11-10), decorative only
  await expect(like.locator('.wf-pop--sm .wf-pop__p')).toHaveCount(7);
  await expect(like).toHaveAccessibleName(/Remover curtida/);
  await page.reload();
  await expect(
    page
      .locator('.wf-review', { hasText: marker })
      .getByRole('button', { name: /Remover curtida/ }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page
    .locator('.wf-review', { hasText: marker })
    .getByRole('button', { name: 'Denunciar' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Spam ou propaganda').check();
  await dialog.getByLabel('Detalhes (opcional)').fill('Teste automático');
  await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(dialog.getByText('Obrigado! A moderação vai dar uma olhada.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar' }).first().click();
  await expect(dialog).toBeHidden();
  expect(await cspViolations(page)).toEqual([]);

  const rows = await withDb((c) =>
    c.query('SELECT reason, note FROM "ReviewReport" WHERE "reviewId" = $1', [id]),
  );
  expect(rows.rows).toEqual([{ reason: 'SPAM', note: 'Teste automático' }]);
  await withDb((c) => c.query('DELETE FROM "Review" WHERE id = $1', [id]));
});

test('a moderator dismisses a report and hides a review from the queue', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'dashboard is a desktop tool');
  const a = await seedReview('a-primeira-live', `Fila: dispensar ${randomUUID().slice(0, 6)}`);
  const b = await seedReview('a-primeira-live', `Fila: ocultar ${randomUUID().slice(0, 6)}`);
  const reporter = await seedUser();
  await withDb(async (c) => {
    await c.query(`UPDATE "User" SET "createdAt" = now() - interval '3 days' WHERE id = $1`, [
      reporter.id,
    ]);
    for (const r of [a, b]) {
      await c.query(
        `INSERT INTO "ReviewReport"(id, "reviewId", "reporterId", reason, note) VALUES ($1, $2, $3, 'OFFENSIVE', 'denúncia e2e')`,
        [randomUUID(), r.id, reporter.id],
      );
    }
  });
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  await signIn(context, mod.token);
  await page.goto('/admin/moderacao');
  await expect(page.getByRole('heading', { name: 'Moderação', level: 1 })).toBeVisible();

  const entryA = page.locator('.wf-mod__entry', { hasText: 'Fila: dispensar' });
  await expect(entryA.getByText('denúncia e2e')).toBeVisible();
  await entryA.getByRole('button', { name: 'Dispensar denúncias' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Dispensar denúncias: feito' }),
  ).toBeVisible();
  await expect(page.locator('.wf-mod__entry', { hasText: 'Fila: dispensar' })).toHaveCount(0);

  const entryB = page.locator('.wf-mod__entry', { hasText: 'Fila: ocultar' });
  await entryB.getByRole('button', { name: 'Ocultar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Ocultar: feito' })).toBeVisible();
  await expect(
    page.locator('#ocultas ~ ul .wf-mod__entry', { hasText: 'Fila: ocultar' }),
  ).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);

  // hidden from the public page
  await page.goto(PAGE);
  await expect(page.getByText('Fila: ocultar')).toHaveCount(0);
  await withDb((c) => c.query('DELETE FROM "Review" WHERE id = ANY($1::uuid[])', [[a.id, b.id]]));
});

test('Avaliações: the latest reviews sit side by side on desktop, one column on phones', async ({
  page,
}, info) => {
  await page.goto('/avaliacoes');
  const cards = page.locator('.wf-reviews__list > li');
  await expect(cards.nth(1)).toBeVisible();
  const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
  if (info.project.name.startsWith('mobile')) {
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1); // stacked
  } else {
    expect(Math.abs(b!.y - a!.y)).toBeLessThan(1); // same row
    expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
    expect(Math.abs(b!.height - a!.height)).toBeLessThan(1); // a row shares its height
  }
});
