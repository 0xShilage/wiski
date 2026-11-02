/**
 * Phase 4 operations end to end: an OBS overlay opened with a real key (fragment exchanged for
 * the cookie and removed from the address, then live SSE updates), the agenda board moving a
 * booked movie, and the public "Próximos na live" strip from the dev seed.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'overlays and the agenda are desktop tools');
});

async function overlayKey(widgets: string[]) {
  const raw = `wfo_${randomBytes(32).toString('base64url')}`;
  await withDb((c) =>
    c.query(
      `INSERT INTO "OverlayKey"(id, label, "keyHash", "keyPrefix", widgets) VALUES ($1, 'e2e', $2, $3, $4)`,
      [randomUUID(), createHash('sha256').update(raw).digest(), raw.slice(4, 10), widgets],
    ),
  );
  return raw;
}

test('home shows the next live with the booked movie', async ({ page }) => {
  await page.goto('/');
  const strip = page.getByRole('region', { name: 'Próximos na live' });
  await expect(strip).toBeVisible();
  await expect(strip.getByRole('link').first()).toBeVisible();
});

test('overlay: the key in the fragment opens the stream and leaves the address bar', async ({
  page,
}) => {
  const key = await overlayKey(['fila', 'meta']);
  await page.goto(`/overlay/fila#k=${key}`);
  await expect(page.getByText('Próximos da fila')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === '__Host-wf_overlay')?.httpOnly).toBe(true);

  // same cookie, another widget the key allows
  await page.goto('/overlay/meta');
  await expect(page.getByText('10 filmes patrocinados no mês')).toBeVisible();

  // a widget the key does not allow
  await page.goto('/overlay/agora');
  await expect(page.getByText('Overlay sem acesso')).toBeVisible();
});

test('overlay "Meta total": one percentage for every board, with a bar per kind', async ({
  page,
}) => {
  await page.goto(`/overlay/meta-total#k=${await overlayKey(['meta-total'])}`);
  const box = page.locator('.wf-overlay__total');
  await expect(box.getByText('Meta total')).toBeVisible();
  await expect(box.locator('.wf-overlay__total-pct')).toHaveText(/^\d{1,3}%$/);
  await expect(box.getByText(/^\d{1,4} de \d{1,4} títulos? garantidos?$/)).toBeVisible();
  // the dev seed has movies, series and franchises on the boards
  await expect(box.locator('.wf-overlay__kinds li')).toHaveText([
    /^Filmes/,
    /^Séries/,
    /^Franquias/,
  ]);
  await expect(box).not.toContainText('R$');
});

test('agenda: a moderator starts the live and the overlay follows over SSE', async ({
  browser,
}) => {
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, mod.token);
  const admin = await ctx.newPage();
  await admin.goto('/admin/agenda');
  await expect(admin.getByRole('heading', { name: 'Nova sessão' })).toBeVisible();

  const overlayCtx = await browser.newContext();
  const overlay = await overlayCtx.newPage();
  await overlay.goto(`/overlay/agora#k=${await overlayKey(['agora'])}`);
  await expect(overlay.locator('main.wf-overlay')).toBeAttached();

  admin.on('dialog', (d) => void d.accept());
  await admin.getByRole('button', { name: 'Começar live' }).first().click();
  await expect(admin.getByText('Sessão ao vivo: feito.')).toBeVisible();
  const nowBtn = admin.getByRole('button', { name: 'Agora assistindo' }).first();
  await nowBtn.click();
  await expect(admin.getByText('Agora assistindo: feito.')).toBeVisible();
  await expect(overlay.getByText('Agora assistindo')).toBeVisible();

  // put the seeded state back for the other specs (the agenda is not undo-able by design)
  await withDb(async (c) => {
    await c.query(`UPDATE "Order" SET status = 'SCHEDULED' WHERE status = 'WATCHING'`);
    await c.query(
      `UPDATE "StreamSession" SET status = 'PLANNED', "startedAt" = NULL, "nowItemId" = NULL WHERE status = 'LIVE'`,
    );
  });
  await ctx.close();
  await overlayCtx.close();
});
