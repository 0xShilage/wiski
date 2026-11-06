/**
 * Phase 4 operations end to end: an OBS overlay opened with a real key (fragment exchanged for
 * the cookie and removed from the address, then live SSE updates), the agenda board moving a
 * booked movie, the public "Próximos na live" strip from the dev seed, and "Já pago" in Pedidos.
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
  await expect(page.getByText('Sem acesso a “Agora assistindo”')).toBeVisible();
});

test('overlay: after the stream drops and a reconnect gets a 502 (a deploy), it recovers by itself', async ({
  page,
}) => {
  const key = await overlayKey(['fila']);
  let n = 0;
  await page.route('**/api/v1/overlay/stream?**', async (route) => {
    n += 1;
    if (n === 1) {
      // a stream that opens, shows something, and ends (like the server's 10-minute rotation)
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: 'retry: 1000\n\ndata: {"type":"queue","items":[{"title":"Título velho","sponsor":null,"jumped":false}]}\n\n',
      });
    }
    if (n === 2) return route.fulfill({ status: 502, body: 'Bad Gateway' });
    return route.continue();
  });
  await page.goto(`/overlay/fila#k=${key}`);
  await expect(page.getByText('Título velho')).toBeVisible();
  // the real stream comes back with the real queue (before 2026-11-05 it froze on the old one)
  await expect(page.getByText('Título velho')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.wf-overlay__queue li').first()).toBeVisible();
  expect(n).toBeGreaterThanOrEqual(3);
});

test('overlay: "Próximos da fila" shows for two minutes, hides, and !fila brings it back', async ({
  page,
}) => {
  const key = await overlayKey(['fila']);
  const command = `wfc_${randomBytes(32).toString('base64url')}`;
  await withDb((c) =>
    c.query(
      `INSERT INTO "AppSetting"(key, value, "updatedAt") VALUES ('subathon.commandKey', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
      [
        JSON.stringify({
          hash: createHash('sha256').update(command).digest('base64url'),
          prefix: command.slice(4, 10),
          createdAt: new Date().toISOString(),
        }),
      ],
    ),
  );
  await page.clock.install();
  await page.goto(`/overlay/fila#k=${key}`);
  const box = page.locator('.wf-overlay__box');
  await expect(box).toBeVisible();
  await page.clock.fastForward('02:05');
  await expect(box).toBeHidden();

  // !fila in chat (StreamElements calls this URL) → back for two minutes
  const res = await page.request.get(`/api/v1/subathon/command?a=fila&k=${command}`);
  expect(res.status()).toBe(200);
  expect(await res.text()).toMatch(/^📋 Próximos na live: 1\. /);
  await expect(box).toBeVisible();
  await page.clock.fastForward('02:05');
  await expect(box).toBeHidden();
});

test('overlay: two keys in one browser (like OBS) both keep working; clear messages otherwise', async ({
  page,
}) => {
  const newer = await overlayKey(['meta-total']);
  const older = await overlayKey(['fila']);
  await page.goto(`/overlay/meta-total#k=${newer}`);
  await expect(page.locator('.wf-overlay__total')).toBeVisible();
  await page.goto(`/overlay/fila#k=${older}`);
  await expect(page.getByText('Próximos da fila')).toBeVisible();
  // the older key did not push the newer one out
  await page.goto('/overlay/meta-total');
  await expect(page.locator('.wf-overlay__total')).toBeVisible();

  // a key that does not list the widget, and a key that does not exist
  await page.goto(`/overlay/agora#k=${older}`);
  await expect(page.getByText('Esta chave não inclui “Agora assistindo”')).toBeVisible();
  await page.goto('about:blank'); // a fresh load, as OBS does (a fragment-only change keeps the page)
  await page.goto(`/overlay/agora#k=wfo_${'A'.repeat(43)}`);
  await expect(page.getByText('Chave inválida ou revogada')).toBeVisible();
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

test('agenda: a custom event goes on a live, shows on the Cronograma and comes off again', async ({
  browser,
}) => {
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, mod.token);
  const admin = await ctx.newPage();
  await admin.goto('/admin/agenda');
  await admin.getByRole('button', { name: 'Adicionar evento' }).first().click();
  const form = admin.getByRole('form', { name: /Novo evento/ });
  await form.getByLabel('Nome do evento').fill('Jogando com os Viewers');
  await form.getByLabel('Duração (minutos)').fill('45');
  await form.getByLabel('No começo da live').check();
  await form.getByRole('button', { name: 'Adicionar evento' }).click();
  await expect(admin.getByText('Evento adicionado: feito.')).toBeVisible();
  const row = admin.locator('li', { hasText: 'Jogando com os Viewers' }).first();
  await expect(row).toContainText('Evento');
  await expect(row).toContainText('No começo');

  const pub = await (await browser.newContext()).newPage();
  await pub.goto('/cronograma');
  const item = pub.locator('.wf-cron__titles li', { hasText: 'Jogando com os Viewers' }).first();
  await expect(item).toBeVisible();
  await expect(item).toContainText('Na live');
  // an event has no title page to link to
  await expect(item.getByRole('link')).toHaveCount(0);

  await row.getByRole('button', { name: 'Tirar da sessão' }).click();
  await expect(admin.getByText('Tirado da sessão: feito.')).toBeVisible();
  await expect(admin.locator('li', { hasText: 'Jogando com os Viewers' })).toHaveCount(0);
  await ctx.close();
});

test('pedidos: the streamer registers a movie as "Já pago" (it enters the queue) and undoes it', async ({
  browser,
}) => {
  const st = await seedUser({ role: 'STREAMER', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, st.token);
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  await page.goto('/admin/pedidos');
  await page.getByRole('button', { name: /Já pago/ }).click();
  const form = page.getByRole('form', { name: 'Já pago' });
  const title = form.getByLabel('Título');
  await expect(title.locator('option').nth(1)).toBeAttached();
  const value = await title
    .locator('optgroup[label="Filmes"] option')
    .first()
    .getAttribute('value');
  const name = (await title.locator(`option[value="${value}"]`).textContent())!.replace(
    /^\d{2} · /,
    '',
  );
  await title.selectOption(value!);
  await expect(form.getByLabel('Valor recebido (R$)')).toHaveValue(/^\d+(,\d{2})?$/);
  await form.getByLabel('Nome público (opcional)').fill('Tia Lu');
  await form.getByRole('button', { name: 'Registrar como pago' }).click();
  await expect(page.getByText(`Pagamento de “${name}” registrado: entrou na fila.`)).toBeVisible();
  const card = page.locator('.wf-ops-card', { hasText: name }).filter({ hasText: 'Já pago' });
  await expect(card.first()).toContainText('Pago fora do site');
  expect(
    await withDb(
      async (c) =>
        (
          await c.query<{ status: string }>(`SELECT status FROM "CatalogItem" WHERE id = $1`, [
            value,
          ])
        ).rows[0]!.status,
    ),
  ).toBe('SPONSORED');

  await card.first().getByRole('button', { name: 'Desfazer registro' }).click();
  await expect(page.getByText('Registro desfeito: feito.')).toBeVisible();
  expect(
    await withDb(
      async (c) =>
        (
          await c.query<{ status: string }>(`SELECT status FROM "CatalogItem" WHERE id = $1`, [
            value,
          ])
        ).rows[0]!.status,
    ),
  ).toBe('ACTIVE');
  await ctx.close();
});
