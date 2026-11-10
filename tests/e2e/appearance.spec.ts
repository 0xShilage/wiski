/**
 * 2026-11-10: seasonal themes (switched in Admin › Aparência), the home pop-up (once per visitor
 * per activation) and "Adiar" on the live agenda.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

const SHOTS = 'test-results/appearance';
mkdirSync(SHOTS, { recursive: true });

const clearSetting = (key: string) =>
  withDb((c) => c.query(`DELETE FROM "AppSetting" WHERE key = $1`, [key]));
const putSetting = (key: string, value: object) =>
  withDb((c) =>
    c.query(
      `INSERT INTO "AppSetting" (key, value, "updatedAt") VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
      [key, JSON.stringify(value)],
    ),
  );

test('seasonal theme: switched on in Aparência, the whole site repaints, switched off again', async ({
  browser,
}, info) => {
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, mod.token);
  const page = await ctx.newPage();
  try {
    await page.goto('/admin/aparencia');
    await expect(page.getByRole('heading', { name: 'Tema sazonal' })).toBeVisible();
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/admin/season'));
    await page.getByRole('radio', { name: /^Natal/ }).click();
    const res = await saved;
    expect(res.status(), await res.text()).toBe(200);
    await expect(page.getByRole('status').filter({ hasText: 'Tema “Natal” ligado' })).toBeVisible();

    await page.goto('/cronograma');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-season', 'natal');
    await expect(page.locator('.wf-header .wf-season-badge--natal svg')).toBeVisible();
    expect(
      await page
        .locator('.wf-header .wf-logo > svg path')
        .first()
        .evaluate((p) => getComputedStyle(p).fill),
    ).toBe('rgb(255, 244, 239)');
    await page.waitForTimeout(600);
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).backgroundImage),
    ).toContain('/seasonal/natal.svg');
    await page.screenshot({ path: `${SHOTS}/natal-${info.project.name}.png` });

    // the other two, straight in the database, for the previews
    for (const theme of ['halloween', 'aniversario'] as const) {
      await putSetting('season', { theme, until: null });
      await page.goto('/cronograma');
      await expect(html).toHaveAttribute('data-season', theme);
      await expect(page.locator(`.wf-season-badge--${theme}`)).toBeVisible();
      await page.waitForTimeout(600); // the tab fade-in
      await page.screenshot({ path: `${SHOTS}/${theme}-${info.project.name}.png` });
    }
    // OBS overlays keep their look
    await page.goto('/overlay/fila');
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).backgroundImage),
    ).toBe('none');

    await page.goto('/admin/aparencia');
    await page.getByRole('radio', { name: /^Nenhum/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Tema desligado' })).toBeVisible();
    await page.goto('/cronograma');
    await expect(html).not.toHaveAttribute('data-season', /.+/);
    await expect(page.locator('.wf-season-badge')).toHaveCount(0);
  } finally {
    await clearSetting('season');
    await ctx.close();
  }
});

test('home pop-up: shows once, stays closed on reload, comes back when switched on again', async ({
  page,
}, info) => {
  const popup = (id: string) => ({
    id,
    active: true,
    title: 'Live especial de Natal',
    body: 'Dia 24, às 20h, maratona com a comunidade.\nTraga a pipoca!',
    imageId: null,
    ctaLabel: 'Ver o cronograma',
    ctaHref: '/cronograma',
    until: null,
    shownFrom: new Date().toISOString(),
  });
  const first = randomUUID();
  await putSetting('popup', popup(first));
  try {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Live especial de Natal' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Traga a pipoca!');
    await expect.poll(() => dialog.evaluate((d) => getComputedStyle(d).opacity)).toBe('1');
    await page.screenshot({ path: `${SHOTS}/popup-${info.project.name}.png` });
    await dialog.getByRole('button', { name: 'Fechar' }).last().click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('wf:popup-seen'))).toBe(first);

    await page.reload();
    await page.waitForTimeout(1500);
    await expect(dialog).toBeHidden();

    // switched on again in the admin panel = a new id → shown once more; Esc closes it too
    await putSetting('popup', popup(randomUUID()));
    await page.reload();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // only on the home page; its button leads where it says
    await putSetting('popup', popup(randomUUID()));
    await page.goto('/links');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto('/');
    await dialog.getByRole('link', { name: 'Ver o cronograma' }).click();
    await expect(page).toHaveURL(/\/cronograma$/);
  } finally {
    await clearSetting('popup');
  }
});

test('agenda: "Adiar" moves a live (and the following ones) by days', async ({ browser }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'admin flow, once');
  const note = `e2e adiar ${randomUUID().slice(0, 6)}`;
  const { id, startsAt } = await withDb(async (c) => {
    const r = await c.query<{ id: string; startsAt: Date }>(
      `INSERT INTO "StreamSession" (id, "startsAt", "capacityMinutes", "publicNote", "updatedAt")
       VALUES (gen_random_uuid(), now() + interval '400 days', 120, $1, now()) RETURNING id, "startsAt"`,
      [note],
    );
    return r.rows[0]!;
  });
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, mod.token);
  const admin = await ctx.newPage();
  try {
    await admin.goto('/admin/agenda');
    const card = admin.locator('section[aria-label^="Sessão de"]').filter({ hasText: note });
    await card.getByRole('button', { name: 'Adiar' }).click();
    const form = card.getByRole('group', { name: /Adiar a live/ });
    await expect(form.getByRole('radio', { name: /Esta e as seguintes \(1 live\)/ })).toBeChecked();
    await form.getByLabel('Adiar por').selectOption('2');
    await form.getByRole('radio', { name: 'Só esta' }).check();
    await admin.screenshot({ path: `${SHOTS}/adiar.png`, fullPage: false });
    await form.getByRole('button', { name: 'Adiar', exact: true }).click();
    await expect(admin.getByText('Agenda adiada: feito.')).toBeVisible();
    const after = await withDb(async (c) => {
      const r = await c.query<{ startsAt: Date }>(
        `SELECT "startsAt" FROM "StreamSession" WHERE id = $1`,
        [id],
      );
      return r.rows[0]!.startsAt;
    });
    expect(after.getTime() - startsAt.getTime()).toBe(2 * 86_400_000);
  } finally {
    await withDb((c) => c.query(`DELETE FROM "StreamSession" WHERE id = $1`, [id]));
    await ctx.close();
  }
});
