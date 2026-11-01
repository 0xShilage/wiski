/**
 * Authenticator-app second factor end to end (2026-10-31): a moderator without 2FA is sent from
 * the panel to /perfil/seguranca, scans (reads) the secret, enters the code, keeps the 6 recovery
 * codes and the panel opens; a new session later needs a code (or a recovery code) — or nothing,
 * when this browser already passed the check in the last 96 hours.
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard is a desktop tool');
});

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secretB32: string, offsetSteps = 0): string {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secretB32.replace(/\s/g, '')) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = mac[mac.length - 1]! & 15;
  const n = ((mac[o]! & 0x7f) << 24) | (mac[o + 1]! << 16) | (mac[o + 2]! << 8) | mac[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

test('set up the authenticator, keep the recovery codes, open the panel', async ({
  page,
  context,
  browser,
}) => {
  const mod = await seedUser({ role: 'MODERATOR' });
  await signIn(context, mod.token);

  await page.goto('/admin/catalogo');
  await expect(
    page.getByRole('heading', { name: 'Ative a verificação em duas etapas' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Ativar agora' }).click();
  await expect(page).toHaveURL(/\/perfil\/seguranca$/);

  await page.getByRole('button', { name: 'Configurar app autenticador' }).click();
  await expect(page.getByRole('img', { name: 'QR code para o app autenticador' })).toBeVisible();
  const secret = (await page.locator('.wf-secret').innerText()).trim();
  expect(secret.replace(/\s/g, '')).toMatch(/^[A-Z2-7]{32}$/);

  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Ativar' }).click();
  const codes = page.getByRole('region', { name: 'Códigos de recuperação' }).locator('code');
  await expect(codes).toHaveCount(6);
  const firstRecovery = (await codes.first().innerText()).trim();
  const done = page.getByRole('button', { name: 'Concluir' });
  await expect(done).toBeDisabled();
  await page.getByLabel('Guardei os códigos').check();
  await done.click();
  await expect(
    page.getByText(/Ativado em .* Códigos de recuperação restantes: 6 de 6/),
  ).toBeVisible();

  await page.goto('/admin/catalogo');
  await expect(page.getByText('● Verificação em duas etapas ok')).toBeVisible();

  // another browser, same account: asked for a code; a recovery code works once
  const other = await browser.newContext({ ignoreHTTPSErrors: true });
  // a second session for the same moderator, as if they signed in with Google elsewhere
  const token = randomBytes(32).toString('base64url');
  await withDb((c) =>
    c.query(
      `INSERT INTO "Session"(id, "tokenHash", "userId", "authTime", "createdAt", "lastSeenAt", "idleExpiresAt", "expiresAt", "uaFamily")
       VALUES ($1, $2, $3, now(), now(), now(), now() + interval '8 hours', now() + interval '1 day', 'Firefox · Linux')`,
      [randomUUID(), createHash('sha256').update(token).digest(), mod.id],
    ),
  );
  await signIn(other, token);
  const p2 = await other.newPage();
  await p2.goto('/admin/catalogo');
  await expect(p2.getByRole('heading', { name: 'Confirme que é você' })).toBeVisible();
  await p2.getByRole('button', { name: /usar um código de recuperação/ }).click();
  await p2.getByLabel(/Código de recuperação/).fill(firstRecovery);
  await p2.getByRole('button', { name: 'Confirmar' }).click();
  await expect(p2.getByText(/Código de recuperação usado. Restam 5/)).toBeVisible();
  await expect(p2.getByText('● Verificação em duas etapas ok')).toBeVisible({ timeout: 10_000 });
  await other.close();
});

test('an action that needs a recent check asks for the code on the page and then completes', async ({
  page,
  context,
}) => {
  // 2026-11-01: Google cannot re-check the password, so step-ups use the second factor
  const st = await seedUser({ role: 'STREAMER' });
  await signIn(context, st.token);
  await page.goto('/perfil/seguranca');
  await page.getByRole('button', { name: 'Configurar app autenticador' }).click();
  const secret = (await page.locator('.wf-secret').innerText()).trim();
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Ativar' }).click();
  await page.getByRole('checkbox', { name: /Guardei os códigos/ }).check();
  await page.getByRole('button', { name: 'Concluir' }).click();

  // an hour later: the Google login is old, the factor check (96 h) is from 30 minutes ago
  await withDb((c) =>
    c.query(
      `UPDATE "Session" SET "authTime" = now() - interval '1 hour', "mfaAt" = now() - interval '30 minutes'
       WHERE "userId" = $1`,
      [st.id],
    ),
  );
  await page.goto('/admin/overlays');
  await page.getByLabel('Nome (ex.: “PC da live”)').fill('PC da live');
  await page.getByRole('button', { name: 'Criar chave' }).click();

  const dialog = page.getByRole('dialog', { name: 'Confirme que é você' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Código do app').fill(totp(secret, 1));
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(dialog).toBeHidden();
  // the same request went through: the one-time URL with the key is on the page
  await expect(page.getByText(/\/overlay\/[a-z]+#k=wfo_/).first()).toBeVisible();
  expect(page.url()).toMatch(/\/admin\/overlays$/); // never left for Google
});
