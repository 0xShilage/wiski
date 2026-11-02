/**
 * The single legal text (2026-11-01): /termos lands on /privacidade, the sections and their
 * anchors, the provisional notice while blanks are open, and the links that point there.
 */
import { expect, test } from '@playwright/test';

test('/termos redirects permanently to /privacidade', async ({ request }) => {
  const res = await request.get('/termos', { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()['location']).toMatch(/\/privacidade$/);
});

test('privacidade: title, 17 sections with anchors, open blanks marked', async ({ page }) => {
  await page.goto('/termos');
  await expect(page).toHaveURL(/\/privacidade$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Política de Privacidade e Proteção de Dados' }),
  ).toBeVisible();
  await expect(page.getByText('Termos de uso e privacidade · Última atualização')).toContainText(
    '1 de novembro de 2026',
  );
  const toc = page.getByRole('navigation', { name: 'Seções' });
  await expect(toc.getByRole('link')).toHaveCount(17);
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(17);
  await toc.getByRole('link').nth(5).click();
  await expect(page).toHaveURL(/#secao-6$/);
  await expect(page.locator('#secao-6')).toBeInViewport();
  await expect(page.locator('#secao-6-2')).toHaveText(/Mercado Pago/);
  // the blanks nobody filled in yet
  await expect(page.getByRole('note')).toContainText('Versão provisória');
  await expect(page.locator('.wf-legal__blank').first()).toHaveText('[a definir]');
  await expect(page.locator('#secao-1 ~ p').first()).toContainText('wiski.fun');
  const google = page.getByRole('link', { name: 'https://policies.google.com/privacy?hl=pt-BR' });
  await expect(google).toHaveAttribute('rel', /noreferrer/);
});

test('footer and the LGPD link point at the one text', async ({ page }) => {
  await page.goto('/');
  const footer = page.getByRole('navigation', { name: 'Informações e contato' });
  await expect(footer.getByRole('link', { name: 'Termos e privacidade' })).toHaveAttribute(
    'href',
    '/privacidade',
  );
  await expect(footer.getByRole('link', { name: 'Termos de uso' })).toHaveCount(0);
  await footer.getByRole('link', { name: 'Canal de privacidade (LGPD)' }).click();
  await expect(page).toHaveURL(/\/privacidade#secao-1$/);
  await expect(page.locator('#secao-1')).toBeInViewport();
});
