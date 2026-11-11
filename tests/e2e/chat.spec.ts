/**
 * Chat da live (2026-11-11): the dashboard page that writes to the Twitch chat as the
 * StreamElements bot. The e2e stack has no STREAMELEMENTS_JWT, so nothing can actually be sent
 * (the sending itself is covered in tests/integration/chat.test.ts); this checks the page.
 * Screenshots go to test-results/chat.
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

const SHOTS = 'test-results/chat';
mkdirSync(SHOTS, { recursive: true });

test('chat da live: compose with placeholders, preview, saved messages', async ({
  browser,
}, info) => {
  await withDb((c) => c.query(`DELETE FROM "AppSetting" WHERE key = 'chat.presets'`));
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, mod.token);
  const page = await ctx.newPage();
  const csp: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to|Hydration/i.test(m.text())) csp.push(m.text());
  });
  try {
    await page.goto('/admin/chat');
    await expect(page.getByRole('heading', { name: 'Chat da live', level: 1 })).toBeVisible();
    // the sidebar links here
    await expect(page.getByRole('link', { name: 'Chat da live' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // no JWT on this stack: the page says so and the send button stays off
    await expect(page.getByText('Bot do StreamElements não configurado')).toBeVisible();
    const send = page.getByRole('button', { name: 'Enviar no chat' });

    const box = page.getByPlaceholder(/Escreva para o chat/);
    await box.fill('Boa noite, chat! Site: ');
    await page.getByRole('button', { name: /^\+ Endereço do site/ }).click();
    await expect(box).toHaveValue('Boa noite, chat! Site: {site}');
    const preview = page.getByLabel('Como vai aparecer no chat');
    await expect(preview).toContainText('StreamElements:');
    await expect(preview).toContainText(/Boa noite, chat! Site: \S+/);
    await expect(preview).not.toContainText('{site}');
    await expect(page.getByText(/^\d+\/500$/)).toBeVisible();
    await expect(send).toBeDisabled();

    // a Twitch command is refused before it could be sent
    await box.fill('/ban alguem');
    await expect(page.getByText(/Comandos do Twitch/).first()).toBeVisible();

    // the default saved messages are there; save a new one from the composer
    const presets = page.getByRole('region', { name: 'Mensagens prontas' });
    await expect(presets.getByText('Patrocinar', { exact: true })).toBeVisible();
    await box.fill('💧 Bebam água, chat!');
    await page.getByRole('button', { name: 'Salvar como pronta' }).click();
    await page.getByLabel('Nome do botão').fill('Hidratar');
    await presets.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByText('Mensagem pronta salva.')).toBeVisible();
    await expect(presets.getByText('Hidratar', { exact: true })).toBeVisible();
    await expect(presets.getByRole('button', { name: 'Enviar “Hidratar” no chat' })).toBeDisabled();
    // "Usar" puts it in the box
    await box.fill('');
    await presets.getByRole('button', { name: 'Usar “Hidratar” na caixa de mensagem' }).click();
    await expect(box).toHaveValue('💧 Bebam água, chat!');

    // no sideways scroll on a phone
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await page.screenshot({ path: `${SHOTS}/chat-${info.project.name}.png`, fullPage: true });

    await presets.getByRole('button', { name: 'Apagar “Hidratar”' }).click();
    await expect(page.getByText('Mensagem pronta apagada.')).toBeVisible();
    await expect(presets.getByText('Hidratar', { exact: true })).toHaveCount(0);
    expect(csp).toEqual([]);
  } finally {
    await withDb((c) => c.query(`DELETE FROM "AppSetting" WHERE key = 'chat.presets'`));
    await ctx.close();
  }
});
