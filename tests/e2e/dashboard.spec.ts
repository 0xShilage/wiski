/**
 * Moderator dashboard end to end (12 §2 step 9 "done when"): passkey enrolment and verification
 * with a WebAuthn virtual authenticator, then create → upload poster/backdrop → publish → the
 * movie appears in the public carousel; edit + revert; a second moderator's stale save → conflict.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import sharp from 'sharp';
import { seedUser, signIn } from './support/seed';

test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'dashboard is a desktop tool');
});

const DIR = 'test-results/e2e-uploads';
const TITLE = `Esquilo E2E ${Date.now().toString(36)}`;

async function fixture(name: string, w: number, h: number) {
  mkdirSync(DIR, { recursive: true });
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + (i >> 9)) & 0xff;
  const file = join(DIR, name);
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 80 })
    .toFile(file);
  return file;
}

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function moderator(context: BrowserContext, verified = true) {
  const m = await seedUser({ role: 'MODERATOR', passkeyVerified: verified });
  await signIn(context, m.token);
  return m;
}

test('passkey: enrol on /perfil/seguranca, then verify to open the dashboard', async ({
  page,
  context,
}) => {
  await moderator(context, false);
  await virtualAuthenticator(page);
  await page.goto('/admin/catalogo');
  await expect(page.getByRole('heading', { name: 'Cadastre uma passkey' })).toBeVisible();
  await page.getByRole('link', { name: 'Cadastrar passkey' }).click();
  await page.getByLabel('Nome (opcional)').fill('Notebook E2E');
  await page.getByRole('button', { name: 'Adicionar passkey' }).click();
  await expect(page.getByText('Passkey cadastrada.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remover Notebook E2E' })).toBeVisible();

  await page.goto('/admin/catalogo');
  await expect(page.getByRole('heading', { name: 'Confirme que é você' })).toBeVisible();
  await page.getByRole('button', { name: 'Verificar com passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Filmes', level: 1 })).toBeVisible();
  await expect(page.getByText('Passkey verificada')).toBeVisible();
});

test('create → upload → publish → the movie is in the carousel', async ({ page, context }) => {
  await moderator(context);
  const poster = await fixture('poster.jpg', 700, 1050);
  const backdrop = await fixture('backdrop.jpg', 1920, 1080);
  await page.goto('/admin/catalogo');
  await page.getByRole('button', { name: 'Novo filme' }).click();
  await page.getByLabel('Título', { exact: true }).fill(TITLE);
  await page.getByLabel('Ano', { exact: true }).fill('2024');
  await page.getByLabel('Duração (minutos)').fill('142');
  await expect(page.getByText('Preço calculado: R$ 32,00')).toBeVisible();
  await page.getByLabel('Classificação indicativa').selectOption('A12');
  await page.getByLabel('Gêneros (separados por vírgula)').fill('Aventura, Comédia');
  await page
    .getByLabel('Sinopse')
    .fill('Um esquilo de teste atravessa a cidade para chegar ao carrossel.');
  await page
    .getByLabel('Trailer (link do YouTube)')
    .fill('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  await expect(page.getByText(/ID válido/)).toBeVisible();

  await page.locator('input[type=file]').nth(0).setInputFiles(poster);
  await expect(page.locator('.wf-drop--poster img')).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type=file]').nth(1).setInputFiles(backdrop);
  await expect(page.locator('.wf-drop--backdrop img')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Publicado: o filme já aparece no carrossel.')).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`Ativo: ${TITLE}`) })).toBeVisible();

  await page.goto('/', { waitUntil: 'networkidle' });
  const next = page.getByRole('button', { name: 'Próximo filme' });
  for (let i = 0; i < 40; i++) {
    if ((await page.locator('.wf-hero__title').textContent()) === TITLE) break;
    await next.click();
  }
  await expect(page.locator('.wf-hero__title')).toHaveText(TITLE);
  await expect(page.locator('.wf-hero__price')).toContainText('R$ 32,00');
  // The processed images come from /media/ (AVIF/WebP), never the uploaded JPEG.
  const src = await page.locator('.wf-hero__art img').getAttribute('src');
  expect(src).toMatch(/^\/media\/[0-9a-f]{32}-\d+\.webp$/);
});

test('edit a live movie, then revert to the previous version', async ({ page, context }) => {
  await moderator(context);
  page.on('dialog', (d) => void d.accept());
  await page.goto('/admin/catalogo');
  await page.getByRole('button', { name: new RegExp(`Ativo: ${TITLE}`) }).click();
  const synopsis = page.getByLabel('Sinopse');
  const original = await synopsis.inputValue();
  await synopsis.fill('Sinopse trocada por engano.');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações publicadas (no ar).')).toBeVisible();
  await page.getByRole('button', { name: /Reverter para a versão 1/ }).click();
  await expect(page.getByText('Revertido para a versão 1.')).toBeVisible();
  await expect(synopsis).toHaveValue(original);
  await expect(page.locator('.wf-history').last()).toContainText('revertido para v1');
});

test('two moderators: the stale save gets a conflict, not a silent overwrite', async ({
  browser,
}) => {
  const a = await browser.newContext({ ignoreHTTPSErrors: true });
  const b = await browser.newContext({ ignoreHTTPSErrors: true });
  await moderator(a);
  await moderator(b);
  const pa = await a.newPage();
  const pb = await b.newPage();
  for (const p of [pa, pb]) {
    await p.goto('/admin/catalogo');
    await p.getByRole('button', { name: new RegExp(`Ativo: ${TITLE}`) }).click();
    await expect(p.getByLabel('Sinopse')).not.toHaveValue('');
  }
  await pa.getByLabel('Direção').fill('Diretora A');
  await pa.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(pa.getByText('Alterações publicadas (no ar).')).toBeVisible();
  await pb.getByLabel('Direção').fill('Diretor B');
  await pb.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(pb.getByRole('alert').filter({ hasText: 'Outra pessoa salvou' })).toBeVisible();
  await pb.getByRole('button', { name: 'Recarregar' }).click();
  // B now sees A's saved value; nothing of B's stale form reached the database.
  await expect(pb.getByLabel('Direção')).toHaveValue('Diretora A');
  await a.close();
  await b.close();
});

test('slot board: Alt + → swaps two live movies', async ({ page, context }) => {
  await moderator(context);
  await page.goto('/admin/catalogo');
  const first = page.locator('.wf-slots li').nth(0).locator('button');
  const name = (await first.getAttribute('title'))!;
  await first.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('.wf-slots li').nth(1).locator('button')).toHaveAttribute(
    'title',
    name,
  );
  await expect(page.locator('[aria-live="polite"]').last()).toContainText('movido para a vaga 2');
  // put it back
  await page.locator('.wf-slots li').nth(1).locator('button').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('.wf-slots li').nth(0).locator('button')).toHaveAttribute(
    'title',
    name,
  );
});
