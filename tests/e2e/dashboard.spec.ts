/**
 * Moderator dashboard end to end (12 §2 step 9 "done when"): passkey enrolment and verification
 * with a WebAuthn virtual authenticator, then create → upload poster/backdrop → publish → the
 * movie appears in the public carousel; edit + revert; a second moderator's stale save → conflict.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import sharp from 'sharp';
import { seedUser, signIn, withDb } from './support/seed';

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

/** A noisy PNG (does not compress): 2400 × 3600 ≈ 26 MB, far over the 10 MB upload cap. */
async function hugePng(name: string, w: number, h: number) {
  mkdirSync(DIR, { recursive: true });
  const raw = randomBytes(w * h * 3);
  const file = join(DIR, name);
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png({ compressionLevel: 1 })
    .toFile(file);
  return file;
}

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const events = { added: 0, asserted: 0 };
  cdp.on('WebAuthn.credentialAdded', () => events.added++);
  cdp.on('WebAuthn.credentialAsserted', () => events.asserted++);
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
  return events;
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
  const authenticator = await virtualAuthenticator(page);
  // What the passkey API answered, for the failure message below (problem bodies only).
  const api: string[] = [];
  page.on('response', async (r) => {
    const path = new URL(r.url()).pathname;
    if (!path.startsWith('/api/v1/me/passkeys/')) return;
    api.push(
      `${r.status()} ${path}${r.ok() ? '' : ` ${(await r.text().catch(() => '')).slice(0, 240)}`}`,
    );
  });
  await page.goto('/admin/catalogo');
  await expect(
    page.getByRole('heading', { name: 'Ative a verificação em duas etapas' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Ativar agora' }).click();
  await page.getByLabel('Nome (opcional)').fill('Notebook E2E');
  await page.getByRole('button', { name: 'Adicionar passkey' }).click();
  // exact: the list's "1 passkey cadastrada." counter may already be on screen too
  await expect(page.getByText('Passkey cadastrada.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remover Notebook E2E' })).toBeVisible();

  await page.goto('/admin/catalogo');
  await expect(page.getByRole('heading', { name: 'Confirme que é você' })).toBeVisible();
  await page.getByRole('button', { name: 'Verificar com passkey' }).click();
  const dashboard = page.getByRole('heading', { name: 'Filmes', level: 1 });
  const problem = page.locator('p.text-danger[role="alert"]');
  // If the gate stays, fail with what happened instead of "element not found".
  const why = () =>
    `passkey gate: authenticator events ${JSON.stringify(authenticator)}, API ${JSON.stringify(api)}`;
  try {
    await expect(dashboard.or(problem)).toBeVisible({ timeout: 15_000 });
  } catch (err) {
    throw new Error(`neither the dashboard nor an error appeared — ${why()}`, { cause: err });
  }
  expect(await problem.allInnerTexts(), why()).toEqual([]);
  await expect(dashboard).toBeVisible();
  await expect(page.getByText('● Verificação em duas etapas ok')).toBeVisible();
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

test('a huge poster (26 MB PNG, 2400×3600) is shrunk in the browser and accepted', async ({
  page,
  context,
}) => {
  await moderator(context);
  const poster = await hugePng('huge-poster.png', 2400, 3600);
  expect(statSync(poster).size).toBeGreaterThan(10 * 1024 * 1024);
  await page.goto('/admin/catalogo');
  await page.getByRole('button', { name: 'Novo filme' }).click();
  const answered = page.waitForResponse((r) => r.url().includes('/api/v1/admin/media?role=POSTER'));
  await page.locator('input[type=file]').nth(0).setInputFiles(poster);
  const res = await answered;
  // the 26 MB original would be refused (413 above 10 MB); the browser's 1200 × 1800 copy is not
  expect(res.status()).toBe(201);
  expect(await res.json()).toMatchObject({ width: 960, height: 1440 }); // largest stored size
  await expect(page.locator('.wf-drop--poster img')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/maior que 10 MB/)).toHaveCount(0);
});

test('"Já pago" from the movie editor: the movie becomes sponsored; undone in Pedidos', async ({
  page,
  context,
}) => {
  const st = await seedUser({ role: 'STREAMER', passkeyVerified: true });
  await signIn(context, st.token);
  page.on('dialog', (d) => void d.accept());
  await page.goto('/admin/catalogo');
  await page.getByRole('button', { name: new RegExp(`Ativo: ${TITLE}`) }).click();
  await page.getByRole('button', { name: 'Já pago' }).click();
  const panel = page.getByRole('group', { name: 'Registrar pagamento fora do site' });
  await expect(panel.getByLabel('Valor recebido (R$)')).toHaveValue(/^\d+(,\d{2})?$/);
  await panel.getByLabel('Nome público (opcional)').fill('Tia Lu');
  await panel.getByRole('button', { name: 'Registrar como pago' }).click();
  await expect(page.getByText('Pagamento registrado: o título entrou na fila.')).toBeVisible();
  // 2026-11-09 ("Fila"): paid, it leaves its slot for the "Na Fila" list under the board
  await expect(
    page.getByRole('region', { name: /Na Fila/ }).getByRole('button', { name: TITLE }),
  ).toBeVisible();
  // a sponsored movie offers no second "Já pago"
  await expect(page.getByRole('button', { name: 'Já pago' })).toHaveCount(0);

  await page.goto('/admin/pedidos');
  const card = page.locator('.wf-ops-card', { hasText: TITLE }).filter({ hasText: 'Já pago' });
  await card.first().getByRole('button', { name: 'Desfazer registro' }).click();
  await expect(page.getByText('Registro desfeito: feito.')).toBeVisible();
});

test('"Já pago" on a draft series: the campaign opens with the goal met; undone in Pedidos', async ({
  page,
  context,
}) => {
  const series = `Série E2E ${Date.now().toString(36)}`;
  const st = await seedUser({ role: 'STREAMER', passkeyVerified: true });
  await signIn(context, st.token);
  page.on('dialog', (d) => void d.accept());
  // a complete draft series (2 seasons), reusing a seeded series' processed images: the upload
  // tests above already spent nginx's upload allowance (2/min per IP)
  await withDb((c) =>
    c.query(
      `INSERT INTO "CatalogItem" (id, kind, slug, status, title, year, "runtimeMinutes", "ageRating",
         genres, synopsis, "cast", "seasonsLabel", "seasonCount", "episodeCount", "posterId",
         "backdropId", "createdById", "updatedAt")
       SELECT gen_random_uuid(), 'SERIES', $1, 'DRAFT', $2, 2022, 900, "ageRating", genres,
         'Uma série de teste que já chega paga.', '{}', 'Temporadas 1–2', 2, 16, "posterId",
         "backdropId", "createdById", now()
       FROM "CatalogItem" WHERE kind = 'SERIES' AND "posterId" IS NOT NULL
         AND "backdropId" IS NOT NULL
       LIMIT 1`,
      [series.toLowerCase().replace(/[^a-z0-9]+/g, '-'), series],
    ),
  );
  await page.goto('/admin/catalogo?tipo=series');
  await page
    .getByRole('region', { name: 'Rascunhos sem vaga' })
    .getByRole('button', { name: series })
    .click();
  await expect(page.getByRole('heading', { name: 'Abrir campanha' })).toBeVisible();

  // the draft's "Abrir campanha" panel offers "Já pago", prefilled with the formula goal
  await page.getByRole('button', { name: 'Já pago' }).click();
  const panel = page.getByRole('group', { name: 'Registrar pagamento fora do site' });
  await expect(panel).toContainText('A campanha abre agora com meta de');
  await expect(panel.getByLabel('Valor recebido (R$)')).toHaveValue(/^\d+(,\d{2})?$/);
  await panel.getByLabel('Nome público (opcional)').fill('Tio Beto');
  await panel.getByRole('button', { name: 'Abrir e registrar como pago' }).click();
  await expect(page.getByText('Pagamento registrado: o título entrou na fila.')).toBeVisible();
  // 2026-11-09 ("Fila"): with its goal met it leaves its slot for the "Na Fila" list
  await expect(
    page.getByRole('region', { name: /Na Fila/ }).getByRole('button', { name: series }),
  ).toBeVisible();
  // a funded campaign offers no second "Já pago"
  await expect(page.getByRole('button', { name: 'Já pago' })).toHaveCount(0);

  await page.goto('/admin/pedidos');
  const card = page.locator('.wf-ops-card', { hasText: series }).filter({ hasText: 'Já pago' });
  await card.first().getByRole('button', { name: 'Desfazer registro' }).click();
  await expect(page.getByText('Registro desfeito: feito.')).toBeVisible();
});
