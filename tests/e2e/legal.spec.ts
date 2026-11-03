/**
 * The legal texts: /termos lands on /privacidade (2026-11-01), the sections and their anchors,
 * the lawyer's final values (2026-11-03), the refund terms at /reembolso, and the links there.
 */
import { expect, test } from '@playwright/test';

test('/termos redirects permanently to /privacidade', async ({ request }) => {
  const res = await request.get('/termos', { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()['location']).toMatch(/\/privacidade$/);
});

test('privacidade: title, 17 sections with anchors, every blank filled in', async ({ page }) => {
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
  // the lawyer's final text (2026-11-03): no blank left, the controller and the channel named
  await expect(page.getByRole('note')).toHaveCount(0);
  await expect(page.locator('.wf-legal__blank')).toHaveCount(0);
  await expect(page.locator('#secao-1 ~ p').first()).toContainText('Strategol Security');
  await expect(
    page.getByRole('link', { name: 'strategol-security@pm.me' }).first(),
  ).toHaveAttribute('href', 'mailto:strategol-security@pm.me');
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

test('reembolso: the refund terms, 17 sections, the three cases and the contact channel', async ({
  page,
}) => {
  await page.goto('/reembolso');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Termo de Reembolso, Estorno e Restituição de Contribuições Financeiras',
    }),
  ).toBeVisible();
  await expect(page.getByText('Reembolso · Última atualização')).toContainText(
    '3 de novembro de 2026',
  );
  await expect(page.getByRole('navigation', { name: 'Seções' }).getByRole('link')).toHaveCount(17);
  await expect(page.locator('#secao-3 ~ ul').first()).toContainText('PAGAMENTO DUPLICADO');
  await expect(page.getByText('Canal de atendimento:')).toContainText('strategol-security@pm.me');
  await expect(page.getByRole('note')).toHaveCount(0);
});
