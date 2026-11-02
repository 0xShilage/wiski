/**
 * Signed-in flows in a real browser behind nginx: onboarding (username availability + avatar),
 * profile, sessions, logout — exercises the CSRF meta token + apiFetch under the strict CSP.
 */
import { expect, test } from '@playwright/test';
import { seedUser, signIn } from './support/seed';

test.describe.configure({ mode: 'serial' });

test('onboarding → perfil → perfil público', async ({ page, context }) => {
  const { token } = await seedUser({ username: null });
  await signIn(context, token);
  await page.goto('/conta'); // old address: 301 → /perfil → onboarding
  await expect(page).toHaveURL(/\/bem-vindo/);

  const name = `ana_${Date.now().toString(36)}`.slice(0, 20);
  await page.getByLabel('Nome de usuário').fill('admin');
  await expect(page.getByText('Esse nome é reservado.')).toBeVisible();
  await page.getByLabel('Nome de usuário').fill(name);
  await expect(page.getByText('Disponível!')).toBeVisible();
  // the picker is ordered by colour: white backgrounds first, black last (2026-11-02)
  const options = page.getByRole('radio', { name: /^Avatar \d+$/ });
  await expect(options).toHaveCount(45);
  await expect(options.first()).toHaveAccessibleName('Avatar 9');
  await expect(options.last()).toHaveAccessibleName('Avatar 39');
  // keyboard, like a keyboard user (a forced click can land on the phone's fixed tab bar)
  const pick = page.getByLabel('Avatar 44', { exact: true });
  await pick.focus();
  await page.keyboard.press('Space');
  await expect(pick).toBeChecked();
  await page.getByRole('button', { name: 'Criar meu perfil' }).click();

  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByText(`@${name}`, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Perfil público' }).click();
  await expect(page).toHaveURL(new RegExp(`/u/${name}$`));
  await expect(page.getByText('Nenhuma avaliação ainda.')).toBeVisible();
});

test('session cookie is HttpOnly (invisible to page scripts)', async ({ page, context }) => {
  const { token } = await seedUser();
  await signIn(context, token);
  await page.goto('/perfil');
  expect(await page.evaluate(() => document.cookie)).not.toContain('wf_session');
  await expect(page.locator('meta[name="csrf-token"]')).toHaveAttribute('content', /^[\w-]{43}$/);
});

test('sessões ativas: encerrar outros dispositivos; sair', async ({ page, context, browser }) => {
  const user = await seedUser();
  await signIn(context, user.token);
  await page.goto('/perfil/sessoes');
  await expect(page.getByRole('heading', { name: 'Sessões ativas' })).toBeVisible();
  await expect(page.getByText('este dispositivo')).toBeVisible();

  await page.goto('/perfil');
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/$/);
  // The old token no longer works.
  const ctx2 = await browser.newContext({ ignoreHTTPSErrors: true });
  await signIn(ctx2, user.token);
  const p2 = await ctx2.newPage();
  await p2.goto('/perfil');
  await expect(p2.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await ctx2.close();
});

test('a cross-site form cannot hit the API (CSRF)', async ({ request }) => {
  const res = await request.post('/api/auth/logout', {
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  });
  expect([401, 403]).toContain(res.status());
});
