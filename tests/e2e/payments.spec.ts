/**
 * Phase 2 checkout end to end (13 §3 step 12), production build behind nginx, Mercado Pago /
 * Turnstile / Resend mocked, approval delivered as a signed notification through nginx and
 * processed by the real worker:
 *   movie (guest) → Pix → approved → "Patrocinado" + receipt e-mail
 *   contribution (signed in) → the open campaign page's bar moves live → "Minhas compras"
 *   expiry → "Reservado" clears
 *   /admin/pedidos (STREAMER with passkey)
 * Every step: 0 enforced CSP violations (Turnstile + QR included), axe clean, no sideways scroll.
 */
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import {
  approveAndNotify,
  fakeTurnstile,
  mockAction,
  mpOrderIdFor,
  notify,
  sentEmails,
  type Violation,
  watchCsp,
} from './support/payments';
import { seedUser, signIn } from './support/seed';

test.describe.configure({ mode: 'serial' });

const MOVIE = { 'mobile-360': 'cidade-insone', 'desktop-1280': 'ponte-violeta' } as const;
const EXPIRING = 'a-casa-das-molduras';
const CAMPAIGN = '/series/ponto-cego';

let csp: Violation[] = [];

test.beforeEach(async ({ page, context }) => {
  await fakeTurnstile(context);
  csp = await watchCsp(page);
});

test.afterEach(() => {
  const enforced = csp.filter((v) => v.disposition === 'enforce');
  expect(enforced, JSON.stringify(enforced, null, 2)).toEqual([]);
});

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  expect(summary, `${label}: ${JSON.stringify(summary, null, 2)}`).toEqual([]);
}

async function fits(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Submit the sheet and land on the order page (or fail with the sheet's error message). */
async function submit(page: Page, button: RegExp | string): Promise<string> {
  await page.getByRole('dialog').getByRole('button', { name: button }).click();
  try {
    await page.waitForURL(/\/pedido\/WF-[0-9A-Z]{6}$/, { timeout: 15_000 });
  } catch (err) {
    const alert = await page
      .getByRole('dialog')
      .locator('.wf-alert, .wf-hint--err')
      .allInnerTexts()
      .catch(() => []);
    throw new Error(`checkout did not reach the order page: ${JSON.stringify(alert)}`, {
      cause: err,
    });
  }
  return /WF-[0-9A-Z]{6}/.exec(page.url())![0];
}

async function shot(page: Page, project: string, name: string, fullPage = true) {
  mkdirSync(`test-results/screens/${project}`, { recursive: true });
  await page.screenshot({ path: `test-results/screens/${project}/${name}.png`, fullPage });
}

/** Fill the sheet's buyer fields, accept the terms, wait for Turnstile, submit. */
async function pay(page: Page, opts: { email?: string; name?: string; message?: string } = {}) {
  const sheet = page.getByRole('dialog');
  if (opts.email) await sheet.getByLabel('E-mail para o comprovante').fill(opts.email);
  if (opts.name) await sheet.getByLabel(/Nome que aparece no site/).fill(opts.name);
  if (opts.message) await sheet.getByLabel(/Mensagem para a live/).fill(opts.message);
  await sheet.getByRole('checkbox', { name: /Li e aceito/ }).check();
  await expect(sheet.getByText('Verificação de segurança (simulada no teste)')).toBeVisible();
  await page.waitForTimeout(300); // the fake widget calls back after 50 ms
}

test('movie: Patrocine agora → Pix → approved → Patrocinado, receipt e-mailed', async ({
  page,
  request,
}, info) => {
  const project = info.project.name as keyof typeof MOVIE;
  await page.goto(`/filmes/${MOVIE[project]}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Patrocine agora' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('row', { name: /Total/ })).toBeVisible();

  // queue jump re-quotes; back to the normal order
  await sheet.getByRole('radio', { name: /Prioridade/ }).check();
  await expect(sheet.getByRole('row', { name: /Prioridade/ })).toBeVisible();
  await sheet.getByRole('radio', { name: /Ordem normal/ }).check();
  await expect(sheet.getByRole('row', { name: /Prioridade/ })).toHaveCount(0);
  await shot(page, project, 'checkout-filme-topo', false);

  await pay(page, {
    email: `e2e-${project}@example.com`,
    name: 'Fã do Esquilo',
    message: 'Bora!',
  });
  await axe(page, 'checkout sheet');
  await fits(page);
  await shot(page, project, 'checkout-filme', false);

  const code = await submit(page, /Gerar Pix de R\$/);
  expect(page.url()).not.toContain('#t='); // the link token never stays in the address bar
  await expect(page.getByRole('heading', { name: /Pague R\$ .* com Pix/ })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code do Pix' })).toBeVisible();
  await expect(page.getByLabel('Pix copia e cola')).toHaveValue(/^0002/);
  await expect(page.getByText('Nome Fictício da Silva')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copiar link do pedido' })).toBeVisible();
  await axe(page, 'order page (pending)');
  await fits(page);
  await shot(page, project, 'pedido-pix');

  // reserved for everyone else meanwhile
  const other = await page.context().browser()!.newPage();
  await other.goto(`/filmes/${MOVIE[project]}`);
  await expect(other.locator('#patrocinar')).toContainText('Reservado');
  await other.close();

  expect(await approveAndNotify(request, code)).toBe(200);
  await expect(page.getByRole('heading', { name: 'Pagamento confirmado!' })).toBeVisible({
    timeout: 15_000,
  });
  await axe(page, 'order page (paid)');
  await shot(page, project, 'pedido-pago');

  await expect
    .poll(async () => (await sentEmails()).some((m) => m.subject.includes(code)), {
      timeout: 15_000,
    })
    .toBe(true);

  await page.goto(`/filmes/${MOVIE[project]}`);
  await expect(page.locator('#patrocinar')).toContainText('Patrocinado');
});

test('contribution (signed in): the open campaign page moves live; Minhas compras lists it', async ({
  page,
  context,
  request,
}, info) => {
  const project = info.project.name;
  const user = await seedUser();
  await signIn(context, user.token);

  // a second tab watching the campaign (live bar)
  const viewer = await context.newPage();
  await viewer.goto(CAMPAIGN, { waitUntil: 'networkidle' });
  const bar = viewer.locator('#contribuir progress');
  await bar.scrollIntoViewIfNeeded();
  const before = Number(await bar.getAttribute('value'));
  await viewer.waitForTimeout(2_500); // live updates start 2 s after the box is on screen

  await page.goto(CAMPAIGN, { waitUntil: 'networkidle' });
  const box = page.locator('#contribuir');
  await box.getByRole('radio', { name: 'R$ 5', exact: true }).check();
  await box.getByRole('button', { name: 'Contribuir com R$ 5,00' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText(`@${user.username}`, { exact: true })).toBeVisible();
  await expect(sheet.getByLabel('E-mail para o comprovante')).toHaveCount(0);
  await pay(page);
  await axe(page, 'contribution sheet');
  await fits(page);
  await shot(page, project, 'checkout-contribuicao', false);
  const code = await submit(page, 'Gerar Pix de R$ 5,00');

  expect(await approveAndNotify(request, code)).toBe(200);
  await expect(page.getByRole('heading', { name: 'Obrigado pela contribuição!' })).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => Number(await bar.getAttribute('value')), { timeout: 15_000 })
    .toBe(before + 500);
  await shot(viewer, project, 'campanha-ao-vivo');
  await viewer.close();

  await page.goto('/perfil');
  const mine = page.locator('#minhas-compras');
  await expect(mine.getByRole('link', { name: /Ponto Cego/ })).toContainText(code);
  await expect(mine).toContainText('Pago');
  await axe(page, 'perfil / minhas compras');
  await shot(page, project, 'minhas-compras');
});

test('expiry: an unpaid Pix expires and "Reservado" clears', async ({ page, request }, info) => {
  const project = info.project.name;
  await page.goto(`/filmes/${EXPIRING}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Patrocine agora' }).click();
  await pay(page, { email: `e2e-expira-${project}@example.com` });
  const code = await submit(page, /Gerar Pix de R\$/);

  const movie = await page.context().newPage();
  await movie.goto(`/filmes/${EXPIRING}`);
  await expect(movie.locator('#patrocinar')).toContainText('Reservado');

  const mp = await mpOrderIdFor(code);
  await mockAction(mp, 'expire');
  expect(await notify(request, mp)).toBe(200);
  await expect(page.getByRole('heading', { name: 'O Pix expirou' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('link', { name: 'Tentar de novo' })).toBeVisible();
  await shot(page, project, 'pedido-expirado');

  await movie.reload();
  await expect(movie.getByRole('button', { name: 'Patrocine agora' })).toBeVisible();
  await movie.close();
});

test('/admin/pedidos: STREAMER with a passkey sees the orders and their detail', async ({
  page,
  context,
}, info) => {
  const project = info.project.name;
  const s = await seedUser({ role: 'STREAMER', passkeyVerified: true });
  await signIn(context, s.token);
  await page.goto('/admin/pedidos?filtro=pagos', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Pedidos', level: 1 })).toBeVisible();
  const rows = page.locator('.wf-olist__row');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect(page.getByRole('region', { name: 'Pedido selecionado' })).toContainText(
    'Valor do pedido',
  );
  await expect(page.getByRole('button', { name: 'Reembolsar' })).toBeVisible();
  await axe(page, '/admin/pedidos');
  await fits(page);
  await shot(page, project, 'admin-pedidos', project !== 'desktop-1280');
});
